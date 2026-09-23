/**
 * Approximate retained heap size of a JSON-like value, in bytes.
 *
 * Used to bound in-memory caches of large object graphs without serializing
 * them. The model follows V8's layout loosely (UTF-16 strings, object headers,
 * property slots); it is deliberately conservative rather than exact. Shared
 * references are counted once, and the walk is iterative so arbitrarily deep
 * values cannot overflow the stack.
 */

const STRING_OVERHEAD = 16;
const OBJECT_OVERHEAD = 40;
const ARRAY_OVERHEAD = 32;
const SLOT_BYTES = 8;

export function approximateSizeOf(value: unknown): number {
  let total = 0;
  const seen = new WeakSet<object>();
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    switch (typeof current) {
      case "string":
        total += STRING_OVERHEAD + current.length * 2;
        continue;
      case "number":
      case "bigint":
        total += SLOT_BYTES;
        continue;
      case "boolean":
        total += 4;
        continue;
      case "object":
        break;
      default:
        continue;
    }
    if (current === null || seen.has(current)) continue;
    seen.add(current);
    if (Array.isArray(current)) {
      total += ARRAY_OVERHEAD + current.length * SLOT_BYTES;
      for (const item of current) stack.push(item);
      continue;
    }
    if (ArrayBuffer.isView(current)) {
      total += OBJECT_OVERHEAD + current.byteLength;
      continue;
    }
    total += OBJECT_OVERHEAD;
    for (const [key, entry] of Object.entries(current)) {
      total += SLOT_BYTES + STRING_OVERHEAD + key.length * 2;
      stack.push(entry);
    }
  }
  return total;
}
