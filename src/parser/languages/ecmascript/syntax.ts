import type { Node } from "web-tree-sitter";
import { cleanName, headStart, nextNonCommentSibling, textOf } from "@/parser/extract/nodes";
import { signatureFromRange } from "@/parser/extract/signature";
import { literalValue } from "./modules";
import {
  COMMENT_TYPES,
  SIGNATURE_SKIP_TYPES,
  TRANSPARENT_EXPRESSIONS,
  ecmascript as es,
} from "./vocabulary";

/** Stateless syntax helpers shared by the JavaScript/TypeScript extractors. */

/** Longest chain of `(x)` / `x as T` wrappers unwrapped when classifying an initializer. */
const MAX_UNWRAP_DEPTH = 16;

/** `(fn)`, `fn as Handler`, `fn satisfies Handler` and `fn!` all classify as `fn`. */
export function unwrapExpression(node: Node): Node {
  let current = node;
  for (let depth = 0; depth < MAX_UNWRAP_DEPTH; depth += 1) {
    if (!es.is(current, ...TRANSPARENT_EXPRESSIONS)) break;
    const inner = current.namedChildren[0];
    if (!inner) break;
    current = inner;
  }
  return current;
}

/**
 * Display name of a declaration's `name` field; string-literal names
 * (`"quoted"() {}`) are unquoted. Null when absent or empty (error recovery).
 */
export function declarationName(source: string, node: Node): string | null {
  const nameNode = es.field(node, "name");
  return nameNode ? nameFromNode(source, nameNode) : null;
}

export function nameFromNode(source: string, nameNode: Node): string | null {
  const raw = es.is(nameNode, "string") ? literalValue(source, nameNode) : textOf(source, nameNode);
  const name = raw === null ? "" : cleanName(raw);
  return name.length > 0 ? name : null;
}

/** Upper bound on nodes visited in one destructuring pattern. */
const MAX_PATTERN_NODES = 1_024;

/**
 * Names bound by a destructuring pattern, in source order:
 * `{ a, b: c, d = 1, ...rest }` -> a, c, d, rest; `[x, [y]]` -> x, y.
 */
export function patternBindings(source: string, pattern: Node): string[] {
  const names: string[] = [];
  const pending: Node[] = [pattern];
  for (let visited = 0; pending.length > 0 && visited < MAX_PATTERN_NODES; visited += 1) {
    const node = pending.pop();
    if (!node) break;
    if (es.is(node, "identifier", "shorthand_property_identifier_pattern")) {
      names.push(textOf(source, node));
    } else if (es.is(node, "pair_pattern")) {
      const value = es.field(node, "value");
      if (value) pending.push(value);
    } else if (es.is(node, "assignment_pattern", "object_assignment_pattern")) {
      const left = es.field(node, "left");
      if (left) pending.push(left);
    } else if (es.is(node, "object_pattern", "array_pattern", "rest_pattern")) {
      const children = node.namedChildren;
      for (let index = children.length - 1; index >= 0; index -= 1) {
        const child = children[index];
        if (child) pending.push(child);
      }
    }
  }
  return names;
}

/** Where the body of a function-like node starts (its end when it has no body). */
export function bodyStart(node: Node): number {
  return es.field(node, "body")?.startIndex ?? node.endIndex;
}

/** Declaration head from the first non-decorator token up to `body` (or the node's end). */
export function headSignature(source: string, node: Node, body: Node | null): string | undefined {
  return signatureFromRange(
    source,
    headStart(node, SIGNATURE_SKIP_TYPES),
    body?.startIndex ?? node.endIndex,
  );
}

/**
 * True when the next declaration after `rangeNode` in the same container
 * declares the same name: TypeScript overload signatures are folded into the
 * implementation (or last signature) that follows them.
 */
export function isFollowedByOverload(
  source: string,
  node: Node,
  rangeNode: Node,
  member: boolean,
): boolean {
  const name = declarationName(source, node);
  if (!name) return false;
  let next = nextNonCommentSibling(rangeNode, COMMENT_TYPES);
  if (next && es.is(next, "export_statement")) next = es.field(next, "declaration") ?? next;
  if (next && es.is(next, "ambient_declaration")) {
    next = next.namedChildren.find((child) => !es.is(child, "comment")) ?? next;
  }
  if (!next) return false;
  const overloadable = member
    ? es.is(next, "method_definition", "method_signature", "abstract_method_signature")
    : es.is(next, "function_declaration", "function_signature");
  return overloadable && declarationName(source, next) === name;
}
