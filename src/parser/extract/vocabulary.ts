import type { Node } from "web-tree-sitter";
import type { GrammarVocabulary } from "@/parser/languages/types";

/** Returned by {@link Vocabulary.typeOf} for node types a module does not handle. */
export const UNLISTED_NODE_TYPE = "<unlisted>";

declare const NODE_TYPE_BRAND: unique symbol;

/**
 * A node whose type was checked by {@link Vocabulary.is}. The brand exists only
 * at compile time; it lets `is()` narrow `Node | null` to a node without
 * narrowing the negative branch to `never`.
 */
export type CheckedNode<T extends string> = Node & { readonly [NODE_TYPE_BRAND]: T };

export interface Vocabulary<T extends string, F extends string> extends GrammarVocabulary {
  readonly nodeTypes: readonly T[];
  readonly fields: readonly F[];
  /**
   * The node's type narrowed to the vocabulary. Switching on the result makes
   * the compiler reject misspelled `case` labels; other types map to
   * {@link UNLISTED_NODE_TYPE}.
   */
  typeOf(node: Node): T | typeof UNLISTED_NODE_TYPE;
  /** Whether the node's type is one of `types`. */
  is<K extends T>(node: Node | null | undefined, ...types: K[]): node is CheckedNode<K>;
  /** Type-checked `childForFieldName`. */
  field(node: Node, name: F): Node | null;
  /** Type-checked `childrenForFieldName`. */
  fieldAll(node: Node, name: F): Node[];
}

/**
 * Declares the node types and field names a language module relies on.
 * Everything referenced through the returned helpers is compile-time checked
 * against these lists, and the lists are validated against the grammar in tests.
 */
export function defineVocabulary<const T extends string, const F extends string>(
  nodeTypes: readonly T[],
  fields: readonly F[],
): Vocabulary<T, F> {
  const known = new Set<string>(nodeTypes);
  return {
    nodeTypes,
    fields,
    typeOf(node) {
      const type = node.type;
      return known.has(type) ? (type as T) : UNLISTED_NODE_TYPE;
    },
    is<K extends T>(node: Node | null | undefined, ...types: K[]): node is CheckedNode<K> {
      if (!node) return false;
      const type = node.type;
      return types.some((candidate) => candidate === type);
    },
    field(node, name) {
      return node.childForFieldName(name);
    },
    fieldAll(node, name) {
      return node.childrenForFieldName(name);
    },
  };
}
