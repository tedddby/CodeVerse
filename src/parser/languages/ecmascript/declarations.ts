import type { Node } from "web-tree-sitter";
import type { SymbolKind } from "@/graph/model/types";
import type { ExtractionBuilder, Visibility } from "@/parser/extract/builder";
import {
  childrenThroughErrors,
  hasToken,
  headStart,
  isUpperSnakeCase,
  textOf,
} from "@/parser/extract/nodes";
import { signatureFromRange } from "@/parser/extract/signature";
import type { ExtractionContext } from "@/parser/languages/types";
import { exportsFromCommonJs } from "./commonjs";
import { addClassMember } from "./members";
import { addImportStatement, addLocalExportClause, addReExport } from "./modules";
import {
  bodyStart,
  declarationName,
  headSignature,
  isFollowedByOverload,
  nameFromNode,
  patternBindings,
  unwrapExpression,
} from "./syntax";
import { FUNCTION_EXPRESSIONS, SIGNATURE_SKIP_TYPES, ecmascript as es } from "./vocabulary";

/** Where a statement lives; decides visibility and whether it shapes the module interface. */
interface Scope {
  /** Enclosing symbol (namespace or class), undefined at file level. */
  parentIndex: number | undefined;
  /** The file's top level: the only scope whose exports form the module interface. */
  fileLevel: boolean;
  /** Inside `declare module` / `declare namespace`: members are implicitly exported. */
  ambient: boolean;
}

interface WorkItem {
  node: Node;
  scope: Scope;
  /** Statements are declarations; members live in class bodies. */
  mode: "statement" | "member";
  /** Set when the declaration is wrapped in `export` (`isDefault` for `export default`). */
  exportMark: { isDefault: boolean } | null;
  /** Node whose lines the symbol spans (e.g. the `export` statement around a declaration). */
  rangeNode: Node;
  /** Direct child of `declare ...`. */
  declared: boolean;
}

/**
 * Walks the structural skeleton of a JavaScript/TypeScript file (statements,
 * namespaces, class bodies) with an explicit stack. Function bodies and
 * expressions are never entered, so work is proportional to the number of
 * declarations and deeply nested code cannot overflow the call stack.
 */
export class EcmascriptDeclarationWalker {
  private readonly builder: ExtractionBuilder;
  private readonly context: ExtractionContext;
  private readonly source: string;
  private readonly stack: WorkItem[] = [];

  constructor(builder: ExtractionBuilder, context: ExtractionContext) {
    this.builder = builder;
    this.context = context;
    this.source = context.source;
  }

  walk(program: Node): void {
    const scope: Scope = { parentIndex: undefined, fileLevel: true, ambient: false };
    this.pushChildren(program, scope, "statement");
    while (this.stack.length > 0) {
      const item = this.stack.pop();
      if (!item) break;
      this.context.deadline.tick();
      if (item.mode === "statement") this.visitStatement(item);
      else if (item.scope.parentIndex !== undefined) {
        addClassMember(this.builder, this.source, item.node, item.scope.parentIndex);
      }
    }
  }

  /**
   * Queues a container's children (looking through syntax-error nodes) in
   * reverse, so they are processed in source order and symbols stay sorted.
   */
  private pushChildren(container: Node, scope: Scope, mode: WorkItem["mode"]): void {
    const nodes = childrenThroughErrors(container, this.context.deadline);
    for (let index = nodes.length - 1; index >= 0; index -= 1) {
      const node = nodes[index];
      if (!node) continue;
      this.stack.push({ node, scope, mode, exportMark: null, rangeNode: node, declared: false });
    }
  }

  private visitStatement(item: WorkItem): void {
    const { node } = item;
    switch (es.typeOf(node)) {
      case "import_statement":
        addImportStatement(this.builder, this.source, node);
        break;
      case "export_statement":
        this.visitExport(item);
        break;
      case "function_declaration":
      case "generator_function_declaration":
        this.addDeclaration(item, "function", es.field(node, "body"));
        break;
      case "function_signature":
        if (!isFollowedByOverload(this.source, node, item.rangeNode, false)) {
          this.addDeclaration(item, "function", null);
        }
        break;
      case "class_declaration":
      case "abstract_class_declaration":
        this.addClass(item, declarationName(this.source, node));
        break;
      case "interface_declaration":
        this.addDeclaration(item, "interface", es.field(node, "body"));
        break;
      case "type_alias_declaration":
        this.addDeclaration(item, "type", es.field(node, "value"));
        break;
      case "enum_declaration":
        this.addDeclaration(item, "enum", es.field(node, "body"));
        break;
      case "internal_module":
      case "module":
        this.addNamespace(item);
        break;
      case "ambient_declaration":
        this.visitAmbient(item);
        break;
      case "lexical_declaration":
      case "variable_declaration":
        this.addVariables(item);
        break;
      case "expression_statement":
        this.visitExpressionStatement(item);
        break;
      case "function_expression":
      case "generator_function":
      case "class":
        this.recoverDeclaration(item);
        break;
      default:
        break;
    }
  }

  /**
   * Inside a syntax error, `export function f() {}` can degrade into a named
   * function/class expression directly under the ERROR node; keep it as a
   * (never exported) declaration.
   */
  private recoverDeclaration(item: WorkItem): void {
    const { node } = item;
    if (!node.parent?.isError || !declarationName(this.source, node)) return;
    if (es.is(node, "class")) this.addClass(item, declarationName(this.source, node));
    else this.addDeclaration(item, "function", es.field(node, "body"));
  }

  private visitExport(item: WorkItem): void {
    const { node, scope } = item;
    const target = es.field(node, "source");
    if (target) {
      addReExport(this.builder, this.source, node, target, scope.fileLevel);
      return;
    }
    const declaration = es.field(node, "declaration");
    if (declaration) {
      const exportMark = { isDefault: hasToken(node, "default") };
      this.stack.push({ ...item, node: declaration, exportMark, rangeNode: node });
      return;
    }
    const value = es.field(node, "value");
    if (value) {
      this.addDefaultExportValue(item, value);
      return;
    }
    const clause = node.namedChildren.find((child) => es.is(child, "export_clause"));
    if (clause) {
      if (scope.fileLevel) addLocalExportClause(this.builder, this.source, clause);
      return;
    }
    // TypeScript `export = target;`
    if (scope.fileLevel && hasToken(node, "=")) {
      const assigned = node.namedChildren.find((child) => !es.is(child, "comment", "decorator"));
      if (es.is(assigned, "identifier")) this.builder.exportLocal(textOf(this.source, assigned));
      this.builder.addExport("default");
    }
  }

  /** `export default <expression>`. */
  private addDefaultExportValue(item: WorkItem, rawValue: Node): void {
    const value = unwrapExpression(rawValue);
    const { scope } = item;
    if (scope.fileLevel) this.builder.addExport("default");
    if (es.is(value, "identifier")) {
      if (scope.fileLevel) this.builder.exportLocal(textOf(this.source, value));
      return;
    }
    const exportItem: WorkItem = { ...item, node: value, exportMark: { isDefault: true } };
    const name = declarationName(this.source, value) ?? "default";
    // Anonymous defaults read best with their keywords: "export default class extends Base".
    const start = headStart(item.node, SIGNATURE_SKIP_TYPES);
    const signature = signatureFromRange(this.source, start, bodyStart(value));
    if (es.is(value, "class")) this.addClass(exportItem, name, signature);
    else if (es.is(value, ...FUNCTION_EXPRESSIONS)) {
      this.addDeclaration(exportItem, "function", null, name, signature);
    }
  }

  /** `declare ...`: members of declared namespaces/modules are implicitly exported. */
  private visitAmbient(item: WorkItem): void {
    for (const child of item.node.namedChildren) {
      if (es.is(child, "comment")) continue;
      if (!es.is(child, "statement_block")) {
        this.stack.push({ ...item, node: child, declared: true });
        continue;
      }
      // `declare global { ... }` augments the global scope: a visible "global" module.
      const index = this.builder.addSymbol({
        name: "global",
        kind: "module",
        range: item.rangeNode,
        visibility: "exported",
        parentIndex: item.scope.parentIndex,
        signature: "declare global",
      });
      this.pushChildren(
        child,
        { parentIndex: index, fileLevel: false, ambient: true },
        "statement",
      );
    }
  }

  private visitExpressionStatement(item: WorkItem): void {
    const expression = item.node.namedChildren[0];
    if (!expression) return;
    if (es.is(expression, "internal_module")) {
      this.addNamespace({ ...item, node: expression });
      return;
    }
    if (!item.scope.fileLevel || !es.is(expression, "assignment_expression")) return;
    const declared = exportsFromCommonJs(this.builder, this.source, expression);
    if (!declared) return;
    // `module.exports.name = function () {}` and friends become exported symbols.
    const value = unwrapExpression(declared.value);
    const exportMark = { isDefault: declared.isDefault };
    const exportItem: WorkItem = { ...item, node: value, exportMark };
    const signature = signatureFromRange(this.source, item.node.startIndex, bodyStart(value));
    if (es.is(value, "class")) this.addClass(exportItem, declared.name, signature);
    else if (es.is(value, ...FUNCTION_EXPRESSIONS)) {
      this.addDeclaration(exportItem, "function", null, declared.name, signature);
    }
  }

  private addNamespace(item: WorkItem): void {
    const { node, scope } = item;
    const nameNode = es.field(node, "name");
    const name = nameNode ? nameFromNode(this.source, nameNode) : null;
    if (!nameNode || !name) return;
    // `declare module "pkg"` declares an external module: always ambient and visible.
    const external = es.is(nameNode, "string");
    const body = es.field(node, "body");
    const index = this.builder.addSymbol({
      name,
      kind: "module",
      range: item.rangeNode,
      visibility: external ? "exported" : this.visibilityOf(item),
      parentIndex: scope.parentIndex,
      signature: headSignature(this.source, node, body),
    });
    if (scope.fileLevel && item.exportMark && !external) this.builder.addExport(name);
    if (!body) return;
    const ambient = scope.ambient || item.declared || external;
    this.pushChildren(body, { parentIndex: index, fileLevel: false, ambient }, "statement");
  }

  private addClass(item: WorkItem, name: string | null, signature?: string): void {
    const body = es.field(item.node, "body");
    const index = this.addDeclaration(item, "class", body, name, signature);
    if (index === null || !body) return;
    const scope: Scope = { parentIndex: index, fileLevel: false, ambient: item.scope.ambient };
    this.pushChildren(body, scope, "member");
  }

  /**
   * Adds a declaration named by its `name` field (or `name`), recording its
   * export. Returns the symbol index, or null when the declaration is unnamed.
   */
  private addDeclaration(
    item: WorkItem,
    kind: SymbolKind,
    body: Node | null,
    name: string | null = declarationName(this.source, item.node),
    signature: string | undefined = headSignature(this.source, item.node, body),
  ): number | null {
    const { scope, exportMark } = item;
    const resolved = name ?? (exportMark?.isDefault ? "default" : null);
    if (!resolved) return null;
    if (scope.fileLevel && exportMark) {
      this.builder.addExport(exportMark.isDefault ? "default" : resolved);
    }
    return this.builder.addSymbol({
      name: resolved,
      kind,
      range: item.rangeNode,
      visibility: this.visibilityOf(item),
      parentIndex: scope.parentIndex,
      signature,
    });
  }

  /** `const a = () => {}`, `const MAX = 1`, `export let x`, `const Klass = class {}`. */
  private addVariables(item: WorkItem): void {
    const { node, scope } = item;
    const keyword = es.is(node, "variable_declaration")
      ? "var"
      : (es.field(node, "kind")?.type ?? "const");
    const declarators = node.namedChildren.filter((child) => es.is(child, "variable_declarator"));
    for (const declarator of declarators) {
      const nameNode = es.field(declarator, "name");
      if (!nameNode) continue;
      if (!es.is(nameNode, "identifier")) {
        // Destructuring declares no single symbol, but its bindings can be exported.
        if (scope.fileLevel && item.exportMark) {
          for (const binding of patternBindings(this.source, nameNode))
            this.builder.addExport(binding);
        }
        continue;
      }
      const name = textOf(this.source, nameNode);
      if (!name) continue;
      const rawValue = es.field(declarator, "value");
      const value = rawValue ? unwrapExpression(rawValue) : null;
      const rangeNode = declarators.length === 1 ? item.rangeNode : declarator;
      const variableItem: WorkItem = { ...item, rangeNode };
      const isFunction = es.is(value, ...FUNCTION_EXPRESSIONS);
      const signatureEnd =
        value && (isFunction || es.is(value, "class"))
          ? bodyStart(value)
          : (rawValue?.startIndex ?? declarator.endIndex);
      const signature = signatureFromRange(
        this.source,
        declarator.startIndex,
        signatureEnd,
        keyword,
      );
      if (value && es.is(value, "class")) {
        this.addClass({ ...variableItem, node: value }, name, signature);
        continue;
      }
      if (scope.fileLevel && item.exportMark) this.builder.addExport(name);
      const constant = keyword === "const" && isUpperSnakeCase(name);
      this.builder.addSymbol({
        name,
        kind: isFunction ? "function" : constant ? "constant" : "variable",
        range: rangeNode,
        visibility: this.visibilityOf(variableItem),
        parentIndex: scope.parentIndex,
        signature,
        // Plain values are noise unless they are part of the module's interface.
        dropUnlessExported: !isFunction,
      });
    }
  }

  private visibilityOf(item: WorkItem): Visibility {
    const { scope, exportMark } = item;
    if (exportMark) return scope.fileLevel ? "exported" : "inherit";
    if (scope.ambient) return "inherit";
    return "hidden";
  }
}
