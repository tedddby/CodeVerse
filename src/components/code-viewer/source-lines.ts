/** Pure helpers for turning file content into renderable lines. */

export const TAB_SIZE = 4;
/** Characters rendered per line; longer (minified) lines are cut with a marker. */
export const MAX_RENDERED_LINE_LENGTH = 3_000;
/** Lines highlighted at most; the rest of a very long file renders as plain text. */
export const MAX_HIGHLIGHTED_LINES = 3_000;

/**
 * Splits content into lines (LF, CRLF or CR). A trailing newline does not
 * produce an extra empty line, matching how editors and GitHub number lines.
 * Empty content yields no lines.
 */
export function splitSourceLines(content: string): string[] {
  if (content === "") return [];
  const lines = content.split(/\r\n|\r|\n/);
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Visual width of a line in columns, expanding tabs to the next tab stop. */
export function visualWidth(line: string, tabSize: number = TAB_SIZE): number {
  let width = 0;
  for (let i = 0; i < line.length; i += 1) {
    width = line.charCodeAt(i) === 9 ? width + tabSize - (width % tabSize) : width + 1;
  }
  return width;
}

/** Widest line in columns (capped at the rendered length), used to size the horizontal scroll area. */
export function maxVisualWidth(
  lines: readonly string[],
  cap: number = MAX_RENDERED_LINE_LENGTH,
): number {
  let max = 0;
  for (const line of lines) {
    // Cheap bound first: a line can never be narrower than its length.
    if (line.length <= max && line.indexOf("\t") === -1) continue;
    const width = Math.min(cap, visualWidth(line.length > cap ? line.slice(0, cap) : line));
    if (width > max) max = width;
    if (max >= cap) return cap;
  }
  return max;
}

export interface VisibleRange {
  /** First rendered line index (0-based, inclusive). */
  start: number;
  /** Last rendered line index (exclusive). */
  end: number;
}

/** Lines to render for a virtualized viewport, including `overscan` lines on both sides. */
export function visibleLineRange(
  scrollTop: number,
  viewportHeight: number,
  lineHeight: number,
  lineCount: number,
  overscan: number,
): VisibleRange {
  if (lineCount === 0 || lineHeight <= 0) return { start: 0, end: 0 };
  const first = Math.max(0, Math.floor(Math.max(0, scrollTop) / lineHeight));
  const visible = Math.max(1, Math.ceil(Math.max(0, viewportHeight) / lineHeight));
  const start = Math.max(0, Math.min(lineCount - 1, first) - overscan);
  const end = Math.min(lineCount, first + visible + overscan);
  return { start, end: Math.max(start, end) };
}

/** scrollTop that places `line` (1-based) about a third of the way down the viewport. */
export function scrollTopForLine(
  line: number,
  lineHeight: number,
  viewportHeight: number,
  lineCount: number,
): number {
  const clamped = Math.min(Math.max(1, line), Math.max(1, lineCount));
  const target = (clamped - 1) * lineHeight - viewportHeight / 3;
  const max = Math.max(0, lineCount * lineHeight - viewportHeight);
  return Math.min(max, Math.max(0, Math.round(target)));
}
