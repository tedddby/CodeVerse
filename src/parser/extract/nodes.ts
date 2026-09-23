import type { Node } from "web-tree-sitter";

/** Longest symbol name kept; longer names (computed keys, minified noise) are clipped. */
const MAX_NAME_LENGTH = 200;

/** 1-based first line of a node. */
export function startLine(node: Node): number {
  return node.startPosition.row + 1;
}

/**
 * 1-based last line of a node. A node that ends at column 0 of a later row
 * (it swallowed the preceding newline) ends on the previous line.
 */
export function endLine(node: Node): number {
  const end = node.endPosition;
  return end.column === 0 && end.row > node.startPosition.row ? end.row : end.row + 1;
}

/** Source text of a node. Slicing the JS string avoids a round trip through WebAssembly. */
export function textOf(source: string, node: Node): string {
  return source.slice(node.startIndex, node.endIndex);
}

export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Normalizes an identifier-like name for output (single line, bounded length). */
export function cleanName(text: string): string {
  const collapsed = collapseWhitespace(text);
  return collapsed.length > MAX_NAME_LENGTH
    ? `${collapsed.slice(0, MAX_NAME_LENGTH - 1)}…`
    : collapsed;
}

/**
 * Text of a name node, or null when the node is absent or empty (error
 * recovery inserts zero-width MISSING identifiers).
 */
export function nameText(source: string, node: Node | null | undefined): string | null {
  if (!node) return null;
  const text = textOf(source, node);
  return text.length > 0 ? text : null;
}

/** Text with every whitespace character removed (dotted/qualified paths). */
export function compactText(source: string, node: Node): string {
  return textOf(source, node).replace(/\s+/g, "");
}

/** Whether `node` has a direct anonymous child (keyword/punctuation token) of the given type. */
export function hasToken(node: Node, token: string): boolean {
  for (let index = 0; index < node.childCount; index += 1) {
    const child = node.child(index);
    if (child && !child.isNamed && child.type === token) return true;
  }
  return false;
}

/**
 * Start offset of a declaration's head, skipping leading children such as
 * decorators, annotations and comments that should not appear in signatures.
 */
export function headStart(node: Node, skipTypes: ReadonlySet<string>): number {
  for (let index = 0; index < node.childCount; index += 1) {
    const child = node.child(index);
    if (child && !skipTypes.has(child.type)) return child.startIndex;
  }
  return node.startIndex;
}

/** The next named sibling that is not a comment. */
export function nextNonCommentSibling(node: Node, commentTypes: ReadonlySet<string>): Node | null {
  let sibling = node.nextNamedSibling;
  while (sibling && commentTypes.has(sibling.type)) sibling = sibling.nextNamedSibling;
  return sibling;
}

/**
 * Named children of `node`, with syntax-error (`ERROR`) nodes replaced by
 * their own named children, in source order. Declarations swallowed by error
 * recovery are then still visited as if they were siblings.
 */
export function childrenThroughErrors(node: Node, deadline?: { tick(): void }): Node[] {
  const result: Node[] = [];
  const pending: Node[] = [...node.namedChildren].reverse();
  while (pending.length > 0) {
    const child = pending.pop();
    if (!child) break;
    if (child.isError) {
      deadline?.tick();
      const nested = child.namedChildren;
      for (let index = nested.length - 1; index >= 0; index -= 1) {
        const grandchild = nested[index];
        if (grandchild) pending.push(grandchild);
      }
    } else {
      result.push(child);
    }
  }
  return result;
}

/** `UPPER_SNAKE_CASE` (optionally with leading underscores), e.g. `MAX_RETRIES`, `_API_V2`. */
export function isUpperSnakeCase(name: string): boolean {
  return /^_*[A-Z][A-Z0-9_]*$/.test(name);
}
