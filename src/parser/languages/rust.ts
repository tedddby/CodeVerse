import type { Node } from "web-tree-sitter";
import type { SymbolKind } from "@/graph/model/types";
import { ExtractionBuilder, type Visibility, topLevelExportNames } from "@/parser/extract/builder";
import { childrenThroughErrors, headStart, nameText, textOf } from "@/parser/extract/nodes";
import { signatureFromRange } from "@/parser/extract/signature";
import { UNLISTED_NODE_TYPE, defineVocabulary } from "@/parser/extract/vocabulary";
import {
  RUST_IMPORTS_QUERY,
  RUST_IMPORTS_QUERY_SOURCE,
  collectRustImports,
  rustImports,
} from "./rust-imports";
import type { Extraction, ExtractionContext, LanguageModule } from "./types";

const rust = defineVocabulary(
  [
    "source_file",
    "declaration_list",
    "line_comment",
    "block_comment",
    "attribute_item",
    "visibility_modifier",
    "function_item",
    "function_signature_item",
    "struct_item",
    "union_item",
    "ordered_field_declaration_list",
    "enum_item",
    "trait_item",
    "type_item",
    "const_item",
    "static_item",
    "mod_item",
    "impl_item",
    "extern_crate_declaration",
    "type_identifier",
    "generic_type",
    "scoped_type_identifier",
    "reference_type",
    "pointer_type",
  ],
  ["name", "body", "type", "trait", "value"],
);

type RustNodeType = (typeof rust.nodeTypes)[number];

/** Items that declare a named type-level symbol at any nesting level. */
const ITEM_KINDS = new Map<RustNodeType, SymbolKind>([
  ["struct_item", "struct"],
  ["union_item", "struct"],
  ["enum_item", "enum"],
  ["type_item", "type"],
  ["const_item", "constant"],
  ["static_item", "constant"],
]);

const SIGNATURE_SKIP_TYPES: ReadonlySet<string> = new Set([
  "attribute_item",
  "line_comment",
  "block_comment",
]);

/** Longest `&mut Box<T>`-style chain unwrapped to find an impl's self type. */
const MAX_TYPE_DEPTH = 8;

type Container = "file" | "mod" | "impl" | "trait";

interface Scope {
  container: Container;
  parentIndex: number | undefined;
  /** Inline module path from the file, e.g. ["api", "v1"] (for `mod x;` declarations). */
  modulePath: readonly string[];
  /** Self type name of an `impl` block. */
  implTarget?: string;
  /** `impl Trait for Type`: items take the visibility of the type. */
  traitImpl?: boolean;
}

interface WorkItem {
  node: Node;
  scope: Scope;
}

interface PendingImplItem {
  index: number;
  target: string;
}

class RustExtractor {
  private readonly builder = new ExtractionBuilder();
  private readonly source: string;
  private readonly context: ExtractionContext;
  private readonly stack: WorkItem[] = [];
  private readonly typeIndexByName = new Map<string, number>();
  private readonly pendingImplItems: PendingImplItem[] = [];

  constructor(context: ExtractionContext) {
    this.context = context;
    this.source = context.source;
  }

  extract(root: Node): Extraction {
    this.pushItems(root, { container: "file", parentIndex: undefined, modulePath: [] });
    while (this.stack.length > 0) {
      const item = this.stack.pop();
      if (!item) break;
      this.context.deadline.tick();
      this.visit(item);
    }
    for (const pending of this.pendingImplItems) {
      const parent = this.typeIndexByName.get(pending.target);
      if (parent !== undefined) this.builder.setParent(pending.index, parent);
    }
    collectRustImports(this.builder, this.context, root);

    const extraction = this.builder.build();
    // Declared items first, then names re-exported with `pub use`.
    const reExported = extraction.exports;
    extraction.exports = [...new Set([...topLevelExportNames(extraction.symbols), ...reExported])];
    return extraction;
  }

  private pushItems(container: Node, scope: Scope): void {
    const items = childrenThroughErrors(container, this.context.deadline);
    for (let index = items.length - 1; index >= 0; index -= 1) {
      const node = items[index];
      if (node) this.stack.push({ node, scope });
    }
  }

  private visit(item: WorkItem): void {
    const { node, scope } = item;
    const type = rust.typeOf(node);
    switch (type) {
      case "function_item":
      case "function_signature_item":
        this.addFunction(item);
        return;
      case "trait_item":
        this.addTrait(item);
        return;
      case "mod_item":
        this.addModule(item);
        return;
      case "impl_item":
        this.visitImpl(item);
        return;
      default:
        break;
    }
    const kind = type === UNLISTED_NODE_TYPE ? undefined : ITEM_KINDS.get(type);
    if (!kind) return;
    // Associated types are not items worth a symbol; associated consts are.
    if (scope.container !== "file" && scope.container !== "mod" && kind !== "constant") return;
    const index = this.addItem(item, kind, this.bodyOf(node, kind));
    if (index !== null && scope.container !== "impl" && kind !== "constant") {
      const name = this.builder.symbolAt(index)?.name;
      if (name && !this.typeIndexByName.has(name)) this.typeIndexByName.set(name, index);
    }
  }

  /** Free functions, methods in `impl` blocks and trait methods (with or without body). */
  private addFunction(item: WorkItem): void {
    const { node, scope } = item;
    const inType = scope.container === "impl" || scope.container === "trait";
    // Bodiless signatures only make sense as trait methods (extern blocks are skipped).
    if (rust.is(node, "function_signature_item") && scope.container !== "trait") return;
    this.addItem(item, inType ? "method" : "function", rust.field(node, "body"));
  }

  private addTrait(item: WorkItem): void {
    const body = rust.field(item.node, "body");
    const index = this.addItem(item, "trait", body);
    if (index === null) return;
    const name = this.builder.symbolAt(index)?.name;
    if (name && !this.typeIndexByName.has(name)) this.typeIndexByName.set(name, index);
    if (body) {
      this.pushItems(body, {
        container: "trait",
        parentIndex: index,
        modulePath: item.scope.modulePath,
      });
    }
  }

  /** `mod x { ... }` is a symbol; `mod x;` is a dependency on another file. */
  private addModule(item: WorkItem): void {
    const { node, scope } = item;
    const name = nameText(this.source, rust.field(node, "name"));
    if (!name) return;
    const body = rust.field(node, "body");
    if (!body) {
      this.builder.addImport({
        specifier: [...scope.modulePath, name].join("::"),
        kind: "module",
        node,
      });
      return;
    }
    const index = this.addItem(item, "module", body);
    if (index === null) return;
    this.pushItems(body, {
      container: "mod",
      parentIndex: index,
      modulePath: [...scope.modulePath, name],
    });
  }

  private visitImpl(item: WorkItem): void {
    const { node, scope } = item;
    const body = rust.field(node, "body");
    if (!body) return;
    const target = this.baseTypeName(rust.field(node, "type"));
    this.pushItems(body, {
      container: "impl",
      parentIndex: undefined,
      modulePath: scope.modulePath,
      implTarget: target ?? undefined,
      traitImpl: rust.field(node, "trait") !== null,
    });
  }

  private addItem(item: WorkItem, kind: SymbolKind, body: Node | null): number | null {
    const { node, scope } = item;
    const name = nameText(this.source, rust.field(node, "name"));
    if (!name) return null;
    const index = this.builder.addSymbol({
      name,
      kind,
      range: node,
      visibility: this.visibility(node, scope),
      parentIndex: scope.container === "impl" ? undefined : scope.parentIndex,
      signature: this.signature(node, kind, body),
    });
    if (scope.container === "impl" && scope.implTarget) {
      this.pendingImplItems.push({ index, target: scope.implTarget });
    }
    return index;
  }

  private visibility(node: Node, scope: Scope): Visibility {
    const modifier = node.namedChildren.find((child) => rust.is(child, "visibility_modifier"));
    if (modifier && textOf(this.source, modifier).startsWith("pub")) return "exported";
    // Trait items and trait implementations are as visible as the trait/type.
    if (scope.container === "trait" || (scope.container === "impl" && scope.traitImpl))
      return "inherit";
    return "hidden";
  }

  /** `Config<T>` -> "Config"; `&mut crate::a::Config` -> "Config". */
  private baseTypeName(type: Node | null): string | null {
    let current = type;
    for (let depth = 0; current && depth < MAX_TYPE_DEPTH; depth += 1) {
      if (rust.is(current, "type_identifier")) return textOf(this.source, current);
      if (rust.is(current, "generic_type", "reference_type", "pointer_type")) {
        current = rust.field(current, "type");
      } else if (rust.is(current, "scoped_type_identifier")) {
        current = rust.field(current, "name");
      } else {
        return null;
      }
    }
    return null;
  }

  /** The node that opens a declaration's body (signatures stop there). */
  private bodyOf(node: Node, kind: SymbolKind): Node | null {
    if (kind === "constant") return rust.field(node, "value");
    if (kind === "type") return rust.field(node, "type");
    return rust.field(node, "body");
  }

  private signature(node: Node, kind: SymbolKind, body: Node | null): string | undefined {
    // Tuple structs (`struct P(i32, i32);`) keep their field list: it is the signature.
    const tupleStruct = body !== null && rust.is(body, "ordered_field_declaration_list");
    const end = tupleStruct || !body ? node.endIndex : body.startIndex;
    return signatureFromRange(this.source, headStart(node, SIGNATURE_SKIP_TYPES), end);
  }
}

/** Rust (`.rs`). */
export const rustModule: LanguageModule = {
  id: "rust",
  displayName: "Rust",
  grammarFile: "tree-sitter-rust.wasm",
  extensions: ["rs"],
  vocabulary: {
    nodeTypes: [...rust.nodeTypes, ...rustImports.nodeTypes],
    fields: [...rust.fields, ...rustImports.fields],
  },
  queries: { [RUST_IMPORTS_QUERY]: RUST_IMPORTS_QUERY_SOURCE },
  extract: (root, context) => new RustExtractor(context).extract(root),
};
