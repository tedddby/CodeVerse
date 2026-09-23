import { defineVocabulary } from "@/parser/extract/vocabulary";

/**
 * Node types shared by tree-sitter-javascript and tree-sitter-typescript (both
 * the `typescript` and `tsx` dialects). The grammars differ in details, so each
 * dialect declares exactly what exists in it and the tests verify that.
 */
const COMMON_NODE_TYPES = [
  "program",
  "comment",
  "decorator",
  "statement_block",
  "expression_statement",
  "import_statement",
  "import_clause",
  "named_imports",
  "namespace_import",
  "import_specifier",
  "export_statement",
  "export_clause",
  "export_specifier",
  "namespace_export",
  "identifier",
  "property_identifier",
  "private_property_identifier",
  "shorthand_property_identifier",
  "string",
  "template_string",
  "template_substitution",
  "function_declaration",
  "generator_function_declaration",
  "function_expression",
  "generator_function",
  "arrow_function",
  "class_declaration",
  "class",
  "class_body",
  "method_definition",
  "lexical_declaration",
  "variable_declaration",
  "variable_declarator",
  "object_pattern",
  "array_pattern",
  "pair_pattern",
  "shorthand_property_identifier_pattern",
  "assignment_pattern",
  "object_assignment_pattern",
  "rest_pattern",
  "assignment_expression",
  "member_expression",
  "parenthesized_expression",
  "object",
  "pair",
  "call_expression",
  "arguments",
  "import",
] as const;

/** Present in both TypeScript dialects (`typescript` and `tsx`) but not in JavaScript. */
const TYPESCRIPT_NODE_TYPES = [
  "function_signature",
  "abstract_class_declaration",
  "interface_declaration",
  "type_alias_declaration",
  "enum_declaration",
  "internal_module",
  "module",
  "ambient_declaration",
  "import_require_clause",
  "method_signature",
  "abstract_method_signature",
  "public_field_definition",
  "accessibility_modifier",
  "as_expression",
  "satisfies_expression",
  "non_null_expression",
] as const;

/** Present only in JavaScript. */
const JAVASCRIPT_NODE_TYPES = ["field_definition"] as const;

const COMMON_FIELDS = [
  "name",
  "body",
  "declaration",
  "value",
  "key",
  "source",
  "alias",
  "left",
  "right",
  "object",
  "property",
  "function",
  "arguments",
  "decorator",
  // `const` / `let` keyword of lexical declarations.
  "kind",
] as const;

/** Superset used by the shared extraction code (compile-time checked). */
export const ecmascript = defineVocabulary(
  [...COMMON_NODE_TYPES, ...TYPESCRIPT_NODE_TYPES, ...JAVASCRIPT_NODE_TYPES],
  COMMON_FIELDS,
);

type EcmascriptNodeType = (typeof ecmascript.nodeTypes)[number];

export type EcmascriptDialect = "typescript" | "javascript";

/** The exact vocabulary of one dialect, validated against its grammar in tests. */
export function dialectVocabulary(dialect: EcmascriptDialect): {
  nodeTypes: readonly string[];
  fields: readonly string[];
} {
  const nodeTypes =
    dialect === "typescript"
      ? [...COMMON_NODE_TYPES, ...TYPESCRIPT_NODE_TYPES]
      : [...COMMON_NODE_TYPES, ...JAVASCRIPT_NODE_TYPES];
  return { nodeTypes, fields: COMMON_FIELDS };
}

/** Wrappers that do not change what an initializer is (`(fn)`, `fn as X`, `fn satisfies X`, `fn!`). */
export const TRANSPARENT_EXPRESSIONS: readonly EcmascriptNodeType[] = [
  "parenthesized_expression",
  "as_expression",
  "satisfies_expression",
  "non_null_expression",
];

export const FUNCTION_EXPRESSIONS: readonly EcmascriptNodeType[] = [
  "arrow_function",
  "function_expression",
  "generator_function",
];

/** Children skipped when computing where a declaration's signature starts. */
export const SIGNATURE_SKIP_TYPES: ReadonlySet<string> = new Set(["decorator", "comment"]);

export const COMMENT_TYPES: ReadonlySet<string> = new Set(["comment"]);
