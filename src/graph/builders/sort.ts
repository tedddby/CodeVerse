/**
 * Deterministic ordering helpers shared by the graph builders.
 *
 * `localeCompare` depends on the runtime's ICU data, so builders compare
 * strings by UTF-16 code units instead. The same inputs therefore produce
 * byte-identical graphs on every server, browser and CI machine.
 */

/** Locale-independent string comparison (UTF-16 code units). */
export function compareStrings(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** Returns a new array of the values sorted with {@link compareStrings}. */
export function sortStrings(values: Iterable<string>): string[] {
  return [...values].sort(compareStrings);
}

/** Compares two tuples element by element (numbers numerically, strings by code unit). */
export function compareTuples(
  a: ReadonlyArray<number | string>,
  b: ReadonlyArray<number | string>,
): number {
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const left = a[index];
    const right = b[index];
    if (left === right || left === undefined || right === undefined) continue;
    if (typeof left === "number" && typeof right === "number") return left - right;
    return compareStrings(String(left), String(right));
  }
  return a.length - b.length;
}

/** Returns a copy of `record` with keys in sorted order (JSON output is key-order sensitive). */
export function sortRecordKeys<T>(record: Readonly<Record<string, T>>): Record<string, T> {
  const sorted: Record<string, T> = {};
  for (const key of sortStrings(Object.keys(record))) {
    const value = record[key];
    if (value !== undefined) sorted[key] = value;
  }
  return sorted;
}

/** Number of "/"-separated directory segments above a path ("a.ts" -> 0, "src/a.ts" -> 1). */
export function directoryDepthOf(path: string): number {
  let depth = 0;
  for (let index = 0; index < path.length; index += 1)
    if (path.charCodeAt(index) === 47) depth += 1;
  return depth;
}
