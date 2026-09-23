import type { Node } from "web-tree-sitter";
import type { ExtractionBuilder } from "@/parser/extract/builder";
import { compactText, textOf } from "@/parser/extract/nodes";
import { defineVocabulary } from "@/parser/extract/vocabulary";
import type { ExtractionContext } from "./types";

/** Node types of Rust `use` trees and crate imports. */
export const rustImports = defineVocabulary(
  [
    "source_file",
    "visibility_modifier",
    "extern_crate_declaration",
    "use_declaration",
    "scoped_use_list",
    "use_list",
    "use_as_clause",
    "use_wildcard",
    "scoped_identifier",
    "identifier",
    "crate",
    "self",
    "super",
    "metavariable",
  ],
  ["argument", "path", "list", "alias", "name"],
);

const rustUse = rustImports;

export const RUST_IMPORTS_QUERY = "imports";

/** `use` and `extern crate` anywhere, including inside functions and inline modules. */
export const RUST_IMPORTS_QUERY_SOURCE = `
(use_declaration) @use
(extern_crate_declaration) @crate
`;

/** Upper bound on paths produced by one `use` declaration (guards generated code). */
const MAX_USE_PATHS = 1_024;

export interface UsePath {
  /** Full path, e.g. "crate::auth::jwt", "std::io::*", "super::models". */
  path: string;
  /** Imported binding: last segment, "*" for globs. */
  name: string;
  /** `as` alias, when present. */
  alias?: string;
}

function joinPath(prefix: string, segment: string): string {
  if (!prefix) return segment;
  if (!segment) return prefix;
  return `${prefix}::${segment}`;
}

/** `::std::fmt` (2015-style absolute paths) is the same crate path as `std::fmt`. */
function normalize(path: string): string {
  return path.startsWith("::") ? path.slice(2) : path;
}

function lastSegment(path: string): string {
  const index = path.lastIndexOf("::");
  return index === -1 ? path : path.slice(index + 2);
}

/**
 * Expands a `use` tree into full paths:
 * `use a::b::{c, d::e as f, self, g::*}` ->
 * "a::b::c", "a::b::d::e" (alias "f"), "a::b", "a::b::g::*".
 * Iterative, so arbitrarily nested groups cannot overflow the stack.
 */
export function expandUseTree(source: string, argument: Node): UsePath[] {
  const results: UsePath[] = [];
  const pending: Array<{ node: Node; prefix: string }> = [{ node: argument, prefix: "" }];
  while (pending.length > 0 && results.length < MAX_USE_PATHS) {
    const item = pending.pop();
    if (!item) break;
    const { node, prefix } = item;
    switch (rustUse.typeOf(node)) {
      case "self": {
        // `use a::{self}` imports the module `a` itself.
        const path = normalize(prefix || "self");
        results.push({ path, name: lastSegment(path) });
        break;
      }
      case "identifier":
      case "scoped_identifier":
      case "crate":
      case "super":
      case "metavariable": {
        const path = normalize(joinPath(prefix, compactText(source, node)));
        results.push({ path, name: lastSegment(path) });
        break;
      }
      case "use_wildcard": {
        const path = normalize(joinPath(prefix, compactText(source, node)));
        results.push({ path, name: "*" });
        break;
      }
      case "use_as_clause": {
        const target = rustUse.field(node, "path");
        const alias = rustUse.field(node, "alias");
        if (!target) break;
        const path = normalize(joinPath(prefix, compactText(source, target)));
        const entry: UsePath = { path, name: lastSegment(path) };
        if (alias) entry.alias = compactText(source, alias);
        results.push(entry);
        break;
      }
      case "scoped_use_list": {
        const scope = rustUse.field(node, "path");
        const list = rustUse.field(node, "list");
        const nextPrefix = scope ? joinPath(prefix, compactText(source, scope)) : prefix;
        if (list) pushListItems(pending, list, nextPrefix);
        break;
      }
      case "use_list":
        pushListItems(pending, node, prefix);
        break;
      default:
        break;
    }
  }
  return results;
}

/** Queues list items in reverse so they are expanded in source order. */
function pushListItems(
  pending: Array<{ node: Node; prefix: string }>,
  list: Node,
  prefix: string,
): void {
  const items = list.namedChildren;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const node = items[index];
    if (node) pending.push({ node, prefix });
  }
}

/**
 * Records every `use` path (expanded) and `extern crate` as imports. File-level
 * `pub use` re-exports add their public names to the export list.
 */
export function collectRustImports(
  builder: ExtractionBuilder,
  context: ExtractionContext,
  root: Node,
): void {
  const { source } = context;
  for (const capture of context.captures(RUST_IMPORTS_QUERY, root)) {
    const node = capture.node;
    if (!rustUse.is(node, "use_declaration")) {
      const nameNode = rustUse.field(node, "name");
      if (nameNode)
        builder.addImport({ specifier: textOf(source, nameNode), kind: "import", node });
      continue;
    }
    const argument = rustUse.field(node, "argument");
    if (!argument) continue;
    const modifier = node.namedChildren.find((child) => rustUse.is(child, "visibility_modifier"));
    const reExported =
      modifier !== undefined &&
      textOf(source, modifier).startsWith("pub") &&
      rustUse.is(node.parent, "source_file");
    for (const entry of expandUseTree(source, argument)) {
      builder.addImport({ specifier: entry.path, kind: "import", node, names: [entry.name] });
      if (reExported && entry.name !== "*") builder.addExport(entry.alias ?? entry.name);
    }
  }
}
