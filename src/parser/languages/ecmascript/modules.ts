import type { Node } from "web-tree-sitter";
import type { ExtractionBuilder } from "@/parser/extract/builder";
import { cleanName, hasToken, textOf } from "@/parser/extract/nodes";
import type { ExtractionContext } from "@/parser/languages/types";
import { ecmascript as es } from "./vocabulary";

/**
 * Module-system extraction for JavaScript/TypeScript: ES imports and
 * re-exports, TypeScript `import x = require()`, and `require()`/`import()`
 * calls anywhere in the file.
 */

/** Query names used by {@link collectCallImports}. */
export const CALL_IMPORTS_QUERY = "callImports";

/**
 * Pattern 0: `require("x")`; pattern 1: `import("x")`. Only a string literal
 * (or a template literal without substitutions) as first argument is a
 * statically known specifier.
 */
export const CALL_IMPORTS_QUERY_SOURCE = `
(call_expression
  function: (identifier) @callee
  arguments: (arguments . [(string) (template_string)] @source)
  (#eq? @callee "require"))
(call_expression
  function: (import)
  arguments: (arguments . [(string) (template_string)] @source))
`;

/**
 * Contents of a string or substitution-free template literal, or null when the
 * value is not statically known.
 */
export function literalValue(source: string, node: Node): string | null {
  if (es.is(node, "template_string")) {
    for (const child of node.namedChildren) {
      if (es.is(child, "template_substitution")) return null;
    }
  } else if (!es.is(node, "string")) {
    return null;
  }
  const raw = textOf(source, node);
  // An unterminated literal (error recovery) has no reliable value.
  const quote = raw[0];
  if (raw.length < 2 || !quote || raw[raw.length - 1] !== quote) return null;
  return raw.slice(1, -1);
}

/** Name of an import/export specifier side (`identifier` or string literal). */
function specifierName(source: string, node: Node | null): string | null {
  if (!node) return null;
  if (es.is(node, "string")) return literalValue(source, node);
  return cleanName(textOf(source, node));
}

/** Names brought in by an `import_clause` ("default", "*" or the imported names). */
function importClauseNames(source: string, clause: Node): string[] {
  const names: string[] = [];
  for (const child of clause.namedChildren) {
    switch (es.typeOf(child)) {
      case "identifier":
        names.push("default");
        break;
      case "namespace_import":
        names.push("*");
        break;
      case "named_imports":
        for (const specifier of child.namedChildren) {
          if (!es.is(specifier, "import_specifier")) continue;
          const name = specifierName(source, es.field(specifier, "name"));
          if (name) names.push(name);
        }
        break;
      default:
        break;
    }
  }
  return names;
}

/** `import ... from "x"`, `import "x"`, `import type ...` and `import fs = require("x")`. */
export function addImportStatement(builder: ExtractionBuilder, source: string, node: Node): void {
  const requireClause = node.namedChildren.find((child) => es.is(child, "import_require_clause"));
  if (requireClause) {
    const target = es.field(requireClause, "source");
    const specifier = target ? literalValue(source, target) : null;
    if (specifier !== null) {
      builder.addImport({ specifier, kind: "require", node, names: ["*"] });
    }
    return;
  }
  const target = es.field(node, "source");
  const specifier = target ? literalValue(source, target) : null;
  if (specifier === null) return;
  const clause = node.namedChildren.find((child) => es.is(child, "import_clause"));
  const names = clause ? importClauseNames(source, clause) : undefined;
  builder.addImport({
    specifier,
    kind: hasToken(node, "type") ? "type-import" : "import",
    node,
    names,
  });
}

/**
 * `export ... from "x"`: records the re-export and, at file level, the names
 * it adds to this module's interface.
 */
export function addReExport(
  builder: ExtractionBuilder,
  source: string,
  node: Node,
  target: Node,
  fileLevel: boolean,
): void {
  const specifier = literalValue(source, target);
  if (specifier === null) return;
  const names: string[] = [];
  let sawClause = false;
  for (const child of node.namedChildren) {
    if (es.is(child, "export_clause")) {
      sawClause = true;
      for (const exportSpecifier of child.namedChildren) {
        if (!es.is(exportSpecifier, "export_specifier")) continue;
        const name = specifierName(source, es.field(exportSpecifier, "name"));
        if (!name) continue;
        names.push(name);
        const alias = specifierName(source, es.field(exportSpecifier, "alias"));
        if (fileLevel) builder.addExport(alias ?? name);
      }
    } else if (es.is(child, "namespace_export")) {
      sawClause = true;
      names.push("*");
      const alias = child.namedChildren[0];
      const aliasName = specifierName(source, alias ?? null);
      if (fileLevel && aliasName) builder.addExport(aliasName);
    }
  }
  // `export * from "x"` has neither clause nor namespace export.
  if (!sawClause) names.push("*");
  builder.addImport({ specifier, kind: "re-export", node, names });
}

/**
 * Local `export { a, b as c }`: the listed local declarations become exported
 * and the public names join the export list.
 */
export function addLocalExportClause(
  builder: ExtractionBuilder,
  source: string,
  clause: Node,
): void {
  for (const specifier of clause.namedChildren) {
    if (!es.is(specifier, "export_specifier")) continue;
    const local = specifierName(source, es.field(specifier, "name"));
    if (!local) continue;
    const alias = specifierName(source, es.field(specifier, "alias"));
    builder.exportLocal(local);
    builder.addExport(alias ?? local);
  }
}

/** `require("x")` and `import("x")` calls anywhere in the file (runs a query, not a walk). */
export function collectCallImports(
  builder: ExtractionBuilder,
  context: ExtractionContext,
  root: Node,
): void {
  for (const capture of context.captures(CALL_IMPORTS_QUERY, root)) {
    if (capture.name !== "source") continue;
    const specifier = literalValue(context.source, capture.node);
    if (specifier === null) continue;
    const call = capture.node.parent?.parent ?? capture.node;
    builder.addImport({
      specifier,
      kind: capture.patternIndex === 0 ? "require" : "dynamic-import",
      node: call,
    });
  }
}
