/**
 * Flow detection for JavaScript files. Flow only honours its pragma in the
 * comments that precede the first statement, so only those are read (and
 * only the first few kilobytes of the file).
 */

const PRAGMA_SCAN_CHARS = 4 * 1024;
const FLOW_PRAGMA = /@(?:no)?flow\b/;

/** Whether the leading comments of `source` carry an `@flow` (or `@noflow`) pragma. */
export function hasFlowPragma(source: string): boolean {
  const head = source.slice(0, PRAGMA_SCAN_CHARS);
  let index = 0;
  if (head.startsWith("#!")) {
    const lineEnd = head.indexOf("\n");
    if (lineEnd === -1) return false;
    index = lineEnd + 1;
  }
  for (;;) {
    while (index < head.length && /\s/.test(head.charAt(index))) index += 1;
    let end: number;
    if (head.startsWith("//", index)) {
      const lineEnd = head.indexOf("\n", index);
      end = lineEnd === -1 ? head.length : lineEnd;
      if (FLOW_PRAGMA.test(head.slice(index, end))) return true;
    } else if (head.startsWith("/*", index)) {
      const close = head.indexOf("*/", index + 2);
      end = close === -1 ? head.length : close + 2;
      if (FLOW_PRAGMA.test(head.slice(index, end))) return true;
    } else {
      return false;
    }
    if (end >= head.length) return false;
    index = end;
  }
}
