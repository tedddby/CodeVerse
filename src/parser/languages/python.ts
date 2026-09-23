import type { Node } from "web-tree-sitter";
import { ExtractionBuilder, type Visibility, topLevelExportNames } from "@/parser/extract/builder";
import {
  childrenThroughErrors,
  headStart,
  isUpperSnakeCase,
  nameText,
  textOf,
} from "@/parser/extract/nodes";
import { signatureFromRange } from "@/parser/extract/signature";
import { defineVocabulary } from "@/parser/extract/vocabulary";
import {
  PYTHON_IMPORTS_QUERY,
  PYTHON_IMPORTS_QUERY_SOURCE,
  collectPythonImports,
  dunderAllNames,
  pythonModules,
} from "./python-modules";
import type { Extraction, ExtractionContext, LanguageModule } from "./types";

const py = defineVocabulary(
  [
    "module",
    "comment",
    "block",
    "decorated_definition",
    "class_definition",
    "function_definition",
    "type_alias_statement",
    "expression_statement",
    "assignment",
    "augmented_assignment",
    "pattern_list",
    "identifier",
    "if_statement",
    "elif_clause",
    "else_clause",
    "try_statement",
    "except_clause",
    "finally_clause",
  ],
  ["name", "body", "definition", "left", "right", "consequence"],
);

interface Scope {
  parentIndex: number | undefined;
  /** Module level (`true`) or directly inside a class body (`false`). */
  moduleLevel: boolean;
}

interface WorkItem {
  node: Node;
  scope: Scope;
  /** Decorated definitions span their decorators. */
  rangeNode: Node;
}

const MODULE_SCOPE: Scope = { parentIndex: undefined, moduleLevel: true };

const SIGNATURE_SKIP_TYPES: ReadonlySet<string> = new Set(["comment"]);

/** Longest `type` wrapper chain followed to find a type alias name. */
const MAX_TYPE_ALIAS_DEPTH = 8;

/**
 * Module level: public unless underscore-prefixed (`__all__` overrides this
 * later). Class members: public members inherit the class's visibility.
 * Dunder names (`__init__`, `__call__`) are part of the public protocol.
 */
function visibilityOf(name: string, scope: Scope): Visibility {
  const dunder = name.length > 4 && name.startsWith("__") && name.endsWith("__");
  if (name.startsWith("_") && !dunder) return "hidden";
  return scope.moduleLevel ? "exported" : "inherit";
}

class PythonExtractor {
  private readonly builder = new ExtractionBuilder();
  private readonly source: string;
  private readonly context: ExtractionContext;
  private readonly stack: WorkItem[] = [];
  /** Names listed in `__all__`, or null when the module does not define it. */
  private dunderAll: string[] | null = null;

  constructor(context: ExtractionContext) {
    this.context = context;
    this.source = context.source;
  }

  extract(root: Node): Extraction {
    this.pushBlock(root, MODULE_SCOPE);
    while (this.stack.length > 0) {
      const item = this.stack.pop();
      if (!item) break;
      this.context.deadline.tick();
      this.visit(item);
    }
    collectPythonImports(this.builder, this.context, root);

    const dunderAll = this.dunderAll;
    if (dunderAll) {
      const listed = new Set(dunderAll);
      this.builder.overrideTopLevelVisibility((name) => listed.has(name));
      for (const name of dunderAll) this.builder.addExport(name);
    }
    const extraction = this.builder.build();
    if (!dunderAll) extraction.exports = topLevelExportNames(extraction.symbols);
    return extraction;
  }

  /** Queues a block's statements in source order. */
  private pushBlock(block: Node, scope: Scope): void {
    const children = childrenThroughErrors(block, this.context.deadline);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const node = children[index];
      if (node) this.stack.push({ node, scope, rangeNode: node });
    }
  }

  private visit(item: WorkItem): void {
    const { node, scope } = item;
    switch (py.typeOf(node)) {
      case "decorated_definition": {
        const definition = py.field(node, "definition");
        if (definition) this.stack.push({ node: definition, scope, rangeNode: node });
        break;
      }
      case "class_definition":
        this.addDefinition(item, "class");
        break;
      case "function_definition":
        // Functions nested in functions are local noise; only module and class level count.
        this.addDefinition(item, scope.moduleLevel ? "function" : "method");
        break;
      case "type_alias_statement":
        if (scope.moduleLevel) this.addTypeAlias(node);
        break;
      case "expression_statement":
        if (scope.moduleLevel) this.visitModuleExpression(node);
        break;
      // Conditional definitions (`if TYPE_CHECKING:`, `try: ... except ImportError:`)
      // belong to the enclosing scope.
      case "if_statement":
      case "try_statement":
        this.pushConditionalBlocks(node, scope);
        break;
      default:
        break;
    }
  }

  private pushConditionalBlocks(node: Node, scope: Scope): void {
    const blocks: Node[] = [];
    const consequence = py.field(node, "consequence") ?? py.field(node, "body");
    if (consequence) blocks.push(consequence);
    for (const clause of node.namedChildren) {
      let body: Node | null | undefined = null;
      if (py.is(clause, "elif_clause")) body = py.field(clause, "consequence");
      else if (py.is(clause, "else_clause")) body = py.field(clause, "body");
      else if (py.is(clause, "except_clause", "finally_clause")) {
        body = clause.namedChildren.find((child) => py.is(child, "block"));
      }
      if (body) blocks.push(body);
    }
    for (let index = blocks.length - 1; index >= 0; index -= 1) {
      const block = blocks[index];
      if (block) this.pushBlock(block, scope);
    }
  }

  /** `class` and `def` (async included); classes queue their body as a class scope. */
  private addDefinition(item: WorkItem, kind: "class" | "function" | "method"): void {
    const { node, scope } = item;
    const name = nameText(this.source, py.field(node, "name"));
    if (!name) return;
    const body = py.field(node, "body");
    const index = this.builder.addSymbol({
      name,
      kind,
      range: item.rangeNode,
      visibility: visibilityOf(name, scope),
      parentIndex: scope.parentIndex,
      signature: this.signature(node, body),
    });
    if (kind === "class" && body) this.pushBlock(body, { parentIndex: index, moduleLevel: false });
  }

  /** Python 3.12 `type Alias[T] = ...`. */
  private addTypeAlias(node: Node): void {
    let nameNode: Node | null = py.field(node, "left");
    for (let depth = 0; nameNode && depth < MAX_TYPE_ALIAS_DEPTH; depth += 1) {
      if (py.is(nameNode, "identifier")) break;
      nameNode = nameNode.firstNamedChild;
    }
    const name = py.is(nameNode, "identifier") ? nameText(this.source, nameNode) : null;
    if (!name) return;
    this.builder.addSymbol({
      name,
      kind: "type",
      range: node,
      visibility: visibilityOf(name, MODULE_SCOPE),
      signature: this.signature(node, py.field(node, "right")),
    });
  }

  /** Module-level `__all__` and UPPER_CASE constant assignments. */
  private visitModuleExpression(statement: Node): void {
    const expression = statement.namedChildren[0];
    const isAssignment = py.is(expression, "assignment");
    if (!expression || (!isAssignment && !py.is(expression, "augmented_assignment"))) return;
    const left = py.field(expression, "left");
    const right = py.field(expression, "right");
    if (!left) return;

    if (py.is(left, "identifier") && textOf(this.source, left) === "__all__") {
      const names = right ? dunderAllNames(this.source, right) : [];
      this.dunderAll = isAssignment ? names : [...(this.dunderAll ?? []), ...names];
      return;
    }
    if (!isAssignment) return;
    const targets = py.is(left, "pattern_list")
      ? left.namedChildren.filter((child) => py.is(child, "identifier"))
      : py.is(left, "identifier")
        ? [left]
        : [];
    for (const target of targets) {
      const name = textOf(this.source, target);
      if (!isUpperSnakeCase(name)) continue;
      // `MAX: int = 3` -> "MAX: int"; values are never included (they may hold secrets).
      const valueStart = right?.startIndex ?? expression.endIndex;
      this.builder.addSymbol({
        name,
        kind: "constant",
        range: statement,
        visibility: visibilityOf(name, MODULE_SCOPE),
        signature:
          targets.length === 1
            ? signatureFromRange(this.source, expression.startIndex, valueStart)
            : name,
      });
    }
  }

  private signature(node: Node, body: Node | null): string | undefined {
    return signatureFromRange(
      this.source,
      headStart(node, SIGNATURE_SKIP_TYPES),
      body?.startIndex ?? node.endIndex,
    );
  }
}

/** Python 3 (`.py`, `.pyi`, `.pyw`). */
export const pythonModule: LanguageModule = {
  id: "python",
  displayName: "Python",
  grammarFile: "tree-sitter-python.wasm",
  extensions: ["py", "pyi", "pyw"],
  vocabulary: {
    nodeTypes: [...py.nodeTypes, ...pythonModules.nodeTypes],
    fields: [...py.fields, ...pythonModules.fields],
  },
  queries: { [PYTHON_IMPORTS_QUERY]: PYTHON_IMPORTS_QUERY_SOURCE },
  extract: (root, context) => new PythonExtractor(context).extract(root),
};
