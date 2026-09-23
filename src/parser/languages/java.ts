import type { Node } from "web-tree-sitter";
import type { SymbolKind } from "@/graph/model/types";
import { ExtractionBuilder, type Visibility, topLevelExportNames } from "@/parser/extract/builder";
import { childrenThroughErrors, compactText, hasToken, nameText } from "@/parser/extract/nodes";
import { signatureFromRange } from "@/parser/extract/signature";
import { UNLISTED_NODE_TYPE, defineVocabulary } from "@/parser/extract/vocabulary";
import type { Extraction, ExtractionContext, LanguageModule } from "./types";

const java = defineVocabulary(
  [
    "program",
    "package_declaration",
    "import_declaration",
    "identifier",
    "scoped_identifier",
    "asterisk",
    "modifiers",
    "marker_annotation",
    "annotation",
    "line_comment",
    "block_comment",
    "class_declaration",
    "record_declaration",
    "interface_declaration",
    "annotation_type_declaration",
    "enum_declaration",
    "class_body",
    "interface_body",
    "annotation_type_body",
    "enum_body",
    "enum_body_declarations",
    "method_declaration",
    "constructor_declaration",
    "compact_constructor_declaration",
  ],
  ["name", "body"],
);

type JavaNodeType = (typeof java.nodeTypes)[number];

const TYPE_KINDS = new Map<JavaNodeType, SymbolKind>([
  ["class_declaration", "class"],
  ["record_declaration", "class"],
  ["interface_declaration", "interface"],
  ["annotation_type_declaration", "interface"],
  ["enum_declaration", "enum"],
]);

/** Symbol kind of a type declaration node, undefined for anything else. */
function typeKindOf(node: Node): SymbolKind | undefined {
  const type = java.typeOf(node);
  return type === UNLISTED_NODE_TYPE ? undefined : TYPE_KINDS.get(type);
}

const ANNOTATION_OR_COMMENT: ReadonlySet<string> = new Set([
  "marker_annotation",
  "annotation",
  "line_comment",
  "block_comment",
]);

interface WorkItem {
  node: Node;
  parentIndex: number | undefined;
  /** Members of interfaces and annotation types are implicitly public. */
  implicitlyPublic: boolean;
}

/**
 * Static imports name a member of a class. The member is dropped when it looks
 * like one (lower-case method/field or UPPER_SNAKE constant) so the specifier
 * points at the class: `org.junit.Assert.assertEquals` -> `org.junit.Assert`.
 */
function isMemberName(segment: string): boolean {
  return /^[\p{Ll}_$]/u.test(segment) || (/^[A-Z][A-Z0-9_]*$/.test(segment) && segment.length > 1);
}

class JavaExtractor {
  private readonly builder = new ExtractionBuilder();
  private readonly source: string;
  private readonly context: ExtractionContext;
  private readonly stack: WorkItem[] = [];

  constructor(context: ExtractionContext) {
    this.context = context;
    this.source = context.source;
  }

  extract(root: Node): Extraction {
    const topLevelTypes: Node[] = [];
    for (const child of childrenThroughErrors(root, this.context.deadline)) {
      this.context.deadline.tick();
      switch (java.typeOf(child)) {
        case "package_declaration": {
          const name = child.namedChildren.find((part) =>
            java.is(part, "scoped_identifier", "identifier"),
          );
          if (name) this.builder.packageName = compactText(this.source, name);
          break;
        }
        case "import_declaration":
          this.addImport(child);
          break;
        default:
          if (typeKindOf(child)) topLevelTypes.push(child);
          break;
      }
    }
    this.pushMembers(topLevelTypes, undefined, false);
    while (this.stack.length > 0) {
      const item = this.stack.pop();
      if (!item) break;
      this.context.deadline.tick();
      this.visit(item);
    }
    const extraction = this.builder.build();
    extraction.exports = topLevelExportNames(extraction.symbols);
    return extraction;
  }

  private addImport(node: Node): void {
    const path = node.namedChildren.find((child) =>
      java.is(child, "scoped_identifier", "identifier"),
    );
    if (!path) return;
    const qualified = compactText(this.source, path);
    const wildcard = node.namedChildren.some((child) => java.is(child, "asterisk"));
    const lastDot = qualified.lastIndexOf(".");
    const lastSegment = qualified.slice(lastDot + 1);

    if (hasToken(node, "static")) {
      if (wildcard) {
        this.builder.addImport({ specifier: qualified, kind: "import", node, names: ["*"] });
      } else if (lastDot > 0 && isMemberName(lastSegment)) {
        this.builder.addImport({
          specifier: qualified.slice(0, lastDot),
          kind: "import",
          node,
          names: [lastSegment],
        });
      } else {
        this.builder.addImport({
          specifier: qualified,
          kind: "import",
          node,
          names: [lastSegment],
        });
      }
      return;
    }
    this.builder.addImport({
      specifier: wildcard ? `${qualified}.*` : qualified,
      kind: "import",
      node,
      names: [wildcard ? "*" : lastSegment],
    });
  }

  private pushMembers(
    nodes: readonly Node[],
    parentIndex: number | undefined,
    implicitlyPublic: boolean,
  ): void {
    for (let index = nodes.length - 1; index >= 0; index -= 1) {
      const node = nodes[index];
      if (node) this.stack.push({ node, parentIndex, implicitlyPublic });
    }
  }

  private visit(item: WorkItem): void {
    const { node } = item;
    const typeKind = typeKindOf(node);
    if (typeKind) {
      this.addType(item, typeKind);
      return;
    }
    if (
      java.is(
        node,
        "method_declaration",
        "constructor_declaration",
        "compact_constructor_declaration",
      )
    ) {
      const name = nameText(this.source, java.field(node, "name"));
      if (!name) return;
      this.builder.addSymbol({
        name,
        kind: "method",
        range: node,
        visibility: this.visibility(node, item.implicitlyPublic),
        parentIndex: item.parentIndex,
        signature: this.signature(node),
      });
    }
  }

  private addType(item: WorkItem, kind: SymbolKind): void {
    const { node } = item;
    const name = nameText(this.source, java.field(node, "name"));
    if (!name) return;
    const index = this.builder.addSymbol({
      name,
      kind,
      range: node,
      visibility: this.visibility(node, item.implicitlyPublic),
      parentIndex: item.parentIndex,
      signature: this.signature(node),
    });
    const body = java.field(node, "body");
    if (!body) return;
    const members: Node[] = [];
    for (const child of childrenThroughErrors(body, this.context.deadline)) {
      if (java.is(child, "enum_body_declarations"))
        members.push(...childrenThroughErrors(child, this.context.deadline));
      else members.push(child);
    }
    const membersPublic = java.is(node, "interface_declaration", "annotation_type_declaration");
    this.pushMembers(members, index, membersPublic);
  }

  /** `public` members are exported; interface members are public unless `private`. */
  private visibility(node: Node, implicitlyPublic: boolean): Visibility {
    const modifiers = node.namedChildren.find((child) => java.is(child, "modifiers"));
    if (modifiers && hasToken(modifiers, "public")) return "exported";
    if (implicitlyPublic && !(modifiers && hasToken(modifiers, "private"))) return "exported";
    return "hidden";
  }

  /** From the first modifier keyword (annotations skipped) to the body. */
  private signature(node: Node): string | undefined {
    let start = node.startIndex;
    const first = node.firstChild;
    if (first && java.is(first, "modifiers")) {
      let keyword: Node | null = null;
      for (let index = 0; index < first.childCount; index += 1) {
        const child = first.child(index);
        if (child && !ANNOTATION_OR_COMMENT.has(child.type)) {
          keyword = child;
          break;
        }
      }
      start = keyword?.startIndex ?? first.nextSibling?.startIndex ?? node.startIndex;
    }
    const body = java.field(node, "body");
    return signatureFromRange(this.source, start, body?.startIndex ?? node.endIndex);
  }
}

/** Java (`.java`). */
export const javaModule: LanguageModule = {
  id: "java",
  displayName: "Java",
  grammarFile: "tree-sitter-java.wasm",
  extensions: ["java"],
  vocabulary: java,
  extract: (root, context) => new JavaExtractor(context).extract(root),
};
