import type { Node } from "web-tree-sitter";
import type { ExtractionBuilder } from "@/parser/extract/builder";
import { compactText, textOf } from "@/parser/extract/nodes";
import { defineVocabulary } from "@/parser/extract/vocabulary";
import type { ExtractionContext } from "./types";

/** Node types of Python imports and `__all__` literals. */
export const pythonModules = defineVocabulary(
  [
    "import_statement",
    "import_from_statement",
    "dotted_name",
    "aliased_import",
    "relative_import",
    "wildcard_import",
    "list",
    "tuple",
    "string",
    "string_content",
    "binary_operator",
    "parenthesized_expression",
  ],
  ["name", "module_name", "left", "right"],
);

const py = pythonModules;

export const PYTHON_IMPORTS_QUERY = "imports";

/**
 * Every import statement in the file, including those inside functions and
 * `try`/`if TYPE_CHECKING` blocks. `from __future__` has its own node type and
 * is therefore never matched.
 */
export const PYTHON_IMPORTS_QUERY_SOURCE = `
(import_statement) @import
(import_from_statement) @import
`;

/** Guards the `__all__` expression walk against pathological concatenations. */
const MAX_ALL_EXPRESSION_NODES = 4_096;

/**
 * `import a.b, c as d` -> "a.b", "c";
 * `from .m import x, y as z` -> ".m" with names ["x", "y"];
 * `from . import x` -> "."; `from pkg import *` -> "pkg" with names ["*"].
 */
export function collectPythonImports(
  builder: ExtractionBuilder,
  context: ExtractionContext,
  root: Node,
): void {
  const { source } = context;
  for (const capture of context.captures(PYTHON_IMPORTS_QUERY, root)) {
    const node = capture.node;
    if (py.is(node, "import_statement")) {
      for (const target of py.fieldAll(node, "name")) {
        const dotted = py.is(target, "aliased_import") ? py.field(target, "name") : target;
        if (dotted)
          builder.addImport({ specifier: compactText(source, dotted), kind: "import", node });
      }
      continue;
    }
    const moduleName = py.field(node, "module_name");
    if (!moduleName) continue;
    const names: string[] = [];
    if (node.namedChildren.some((child) => py.is(child, "wildcard_import"))) names.push("*");
    for (const target of py.fieldAll(node, "name")) {
      const imported = py.is(target, "aliased_import") ? py.field(target, "name") : target;
      if (imported) names.push(compactText(source, imported));
    }
    builder.addImport({ specifier: compactText(source, moduleName), kind: "import", node, names });
  }
}

/**
 * String literals of an `__all__` value: lists and tuples of strings, following
 * `+` concatenations (`["a"] + other.__all__` contributes "a").
 */
export function dunderAllNames(source: string, expression: Node): string[] {
  const names: string[] = [];
  const pending: Node[] = [expression];
  let visited = 0;
  while (pending.length > 0 && visited < MAX_ALL_EXPRESSION_NODES) {
    const node = pending.pop();
    if (!node) break;
    visited += 1;
    if (py.is(node, "list", "tuple", "parenthesized_expression")) {
      const children = node.namedChildren;
      for (let index = children.length - 1; index >= 0; index -= 1) {
        const child = children[index];
        if (child) pending.push(child);
      }
    } else if (py.is(node, "binary_operator")) {
      const right = py.field(node, "right");
      const left = py.field(node, "left");
      if (right) pending.push(right);
      if (left) pending.push(left);
    } else if (py.is(node, "string")) {
      const content = node.namedChildren.find((child) => py.is(child, "string_content"));
      if (content) names.push(textOf(source, content));
    }
  }
  return names;
}
