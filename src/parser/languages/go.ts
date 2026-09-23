import type { Node } from "web-tree-sitter";
import type { SymbolKind } from "@/graph/model/types";
import { ExtractionBuilder, type Visibility, topLevelExportNames } from "@/parser/extract/builder";
import { childrenThroughErrors, nameText, textOf } from "@/parser/extract/nodes";
import { signatureFromRange } from "@/parser/extract/signature";
import { defineVocabulary } from "@/parser/extract/vocabulary";
import type { Extraction, ExtractionContext, LanguageModule } from "./types";

const go = defineVocabulary(
  [
    "source_file",
    "package_clause",
    "package_identifier",
    "import_declaration",
    "import_spec_list",
    "import_spec",
    "interpreted_string_literal",
    "raw_string_literal",
    "function_declaration",
    "method_declaration",
    "parameter_declaration",
    "type_identifier",
    "pointer_type",
    "generic_type",
    "parenthesized_type",
    "type_declaration",
    "type_spec",
    "type_alias",
    "struct_type",
    "interface_type",
    "field_declaration_list",
    "const_declaration",
    "const_spec",
    "var_declaration",
    "var_spec_list",
    "var_spec",
  ],
  ["name", "path", "body", "receiver", "type", "value"],
);

/** Go exports identifiers whose first character is an upper-case letter. */
function isExportedName(name: string): boolean {
  return /^\p{Lu}/u.test(name);
}

/** Unquotes `"fmt"` or a raw `` `fmt` `` import path. */
function importPath(source: string, literal: Node): string | null {
  const raw = textOf(source, literal);
  // An unterminated literal (error recovery) has no reliable value.
  const quote = raw[0];
  if (raw.length < 2 || !quote || raw[raw.length - 1] !== quote) return null;
  return raw.slice(1, -1);
}

/** Longest receiver type chain followed (`*pkg.T[K]` style wrappers). */
const MAX_RECEIVER_DEPTH = 8;

interface PendingMethod {
  index: number;
  receiverType: string;
}

class GoExtractor {
  private readonly builder = new ExtractionBuilder();
  private readonly source: string;
  private readonly context: ExtractionContext;
  private readonly typeIndexByName = new Map<string, number>();
  private readonly pendingMethods: PendingMethod[] = [];

  constructor(context: ExtractionContext) {
    this.context = context;
    this.source = context.source;
  }

  extract(root: Node): Extraction {
    for (const child of childrenThroughErrors(root, this.context.deadline)) {
      this.context.deadline.tick();
      switch (go.typeOf(child)) {
        case "package_clause": {
          const name = child.namedChildren.find((part) => go.is(part, "package_identifier"));
          if (name) this.builder.packageName = textOf(this.source, name);
          break;
        }
        case "import_declaration":
          this.addImports(child);
          break;
        case "function_declaration":
          this.addFunction(child, "function");
          break;
        case "method_declaration":
          this.addFunction(child, "method");
          break;
        case "type_declaration":
          this.addTypes(child);
          break;
        case "const_declaration":
          this.addValues(child, "const");
          break;
        case "var_declaration":
          this.addValues(child, "var");
          break;
        default:
          break;
      }
    }
    // Methods may be declared before (or without) their receiver type.
    for (const method of this.pendingMethods) {
      const parent = this.typeIndexByName.get(method.receiverType);
      if (parent !== undefined) this.builder.setParent(method.index, parent);
    }
    const extraction = this.builder.build();
    extraction.exports = topLevelExportNames(extraction.symbols);
    return extraction;
  }

  private addImports(declaration: Node): void {
    const specs: Node[] = [];
    for (const child of declaration.namedChildren) {
      if (go.is(child, "import_spec")) specs.push(child);
      else if (go.is(child, "import_spec_list")) {
        for (const spec of child.namedChildren) if (go.is(spec, "import_spec")) specs.push(spec);
      }
    }
    for (const spec of specs) {
      const literal = go.field(spec, "path");
      if (!literal || !go.is(literal, "interpreted_string_literal", "raw_string_literal")) continue;
      const specifier = importPath(this.source, literal);
      if (specifier) this.builder.addImport({ specifier, kind: "import", node: spec });
    }
  }

  private addFunction(node: Node, kind: SymbolKind): void {
    const name = nameText(this.source, go.field(node, "name"));
    if (!name) return;
    const body = go.field(node, "body");
    const index = this.builder.addSymbol({
      name,
      kind,
      range: node,
      visibility: this.visibility(name),
      signature: signatureFromRange(
        this.source,
        node.startIndex,
        body?.startIndex ?? node.endIndex,
      ),
    });
    if (kind !== "method") return;
    const receiver = go.field(node, "receiver");
    const receiverType = receiver ? this.receiverTypeName(receiver) : null;
    if (receiverType) this.pendingMethods.push({ index, receiverType });
  }

  /** `(s *Service)` -> "Service"; `(b B[T])` -> "B". */
  private receiverTypeName(receiver: Node): string | null {
    const parameter = receiver.namedChildren.find((child) => go.is(child, "parameter_declaration"));
    let type = parameter ? go.field(parameter, "type") : null;
    for (let depth = 0; type && depth < MAX_RECEIVER_DEPTH; depth += 1) {
      if (go.is(type, "type_identifier")) return textOf(this.source, type);
      if (go.is(type, "generic_type")) type = go.field(type, "type");
      else if (go.is(type, "pointer_type", "parenthesized_type"))
        type = type.namedChildren[0] ?? null;
      else return null;
    }
    return null;
  }

  private addTypes(declaration: Node): void {
    for (const spec of declaration.namedChildren) {
      if (!go.is(spec, "type_spec", "type_alias")) continue;
      const name = nameText(this.source, go.field(spec, "name"));
      if (!name) continue;
      const type = go.field(spec, "type");
      const kind: SymbolKind =
        go.is(spec, "type_spec") && go.is(type, "struct_type")
          ? "struct"
          : go.is(spec, "type_spec") && go.is(type, "interface_type")
            ? "interface"
            : "type";
      const range = declaration.namedChildCount === 1 ? declaration : spec;
      const index = this.builder.addSymbol({
        name,
        kind,
        range,
        visibility: this.visibility(name),
        signature: signatureFromRange(
          this.source,
          spec.startIndex,
          this.typeBodyStart(spec, type),
          "type",
        ),
      });
      if (!this.typeIndexByName.has(name)) this.typeIndexByName.set(name, index);
    }
  }

  /** Where the `{` of a struct/interface type starts; the spec's end for other types. */
  private typeBodyStart(spec: Node, type: Node | null): number {
    if (type && go.is(type, "struct_type")) {
      const fields = type.namedChildren.find((child) => go.is(child, "field_declaration_list"));
      if (fields) return fields.startIndex;
    }
    if (type && go.is(type, "interface_type")) {
      for (let index = 0; index < type.childCount; index += 1) {
        const child = type.child(index);
        if (child && child.type === "{") return child.startIndex;
      }
    }
    return spec.endIndex;
  }

  /** Exported package-level constants and variables (unexported ones are noise). */
  private addValues(declaration: Node, keyword: "const" | "var"): void {
    const specs: Node[] = [];
    for (const child of declaration.namedChildren) {
      if (go.is(child, "const_spec", "var_spec")) specs.push(child);
      else if (go.is(child, "var_spec_list")) {
        for (const spec of child.namedChildren) if (go.is(spec, "var_spec")) specs.push(spec);
      }
    }
    for (const spec of specs) {
      const value = go.field(spec, "value");
      const range = specs.length === 1 ? declaration : spec;
      for (const nameNode of go.fieldAll(spec, "name")) {
        const name = nameText(this.source, nameNode);
        if (!name || !isExportedName(name)) continue;
        this.builder.addSymbol({
          name,
          kind: keyword === "const" ? "constant" : "variable",
          range,
          visibility: "exported",
          signature: signatureFromRange(
            this.source,
            spec.startIndex,
            value?.startIndex ?? spec.endIndex,
            keyword,
          ),
        });
      }
    }
  }

  private visibility(name: string): Visibility {
    return isExportedName(name) ? "exported" : "hidden";
  }
}

/** Go (`.go`). */
export const goModule: LanguageModule = {
  id: "go",
  displayName: "Go",
  grammarFile: "tree-sitter-go.wasm",
  extensions: ["go"],
  vocabulary: go,
  extract: (root, context) => new GoExtractor(context).extract(root),
};
