/**
 * Size-based line estimates for files whose content was not downloaded.
 *
 * Averages are typical bytes-per-line (including the newline) measured across
 * large open-source corpora; they only need to be good enough to size a building
 * and to keep directory totals plausible. Every estimate is flagged as such in
 * the graph (`linesEstimated`), so the UI can say "~12K lines".
 */

const BYTES_PER_LINE: ReadonlyMap<string, number> = new Map([
  ["typescript", 34],
  ["javascript", 32],
  ["python", 32],
  ["java", 38],
  ["go", 30],
  ["rust", 34],
  ["c", 30],
  ["cpp", 32],
  ["csharp", 36],
  ["objective-c", 36],
  ["swift", 34],
  ["kotlin", 36],
  ["scala", 36],
  ["ruby", 28],
  ["php", 34],
  ["dart", 34],
  ["elixir", 30],
  ["haskell", 32],
  ["lua", 30],
  ["shell", 30],
  ["sql", 40],
  ["markdown", 50],
  ["rst", 50],
  ["text", 60],
  ["json", 26],
  ["yaml", 24],
  ["toml", 26],
  ["ini", 28],
  ["xml", 44],
  ["html", 44],
  ["css", 24],
  ["scss", 24],
  ["less", 24],
  ["svg", 120],
  ["csv", 48],
  ["vue", 34],
  ["svelte", 34],
]);

const DEFAULT_BYTES_PER_LINE = 36;

/**
 * Estimates the number of lines of a text file from its size in bytes.
 * Returns 0 for empty (or unknown-size) files and at least 1 otherwise.
 * Callers are responsible for returning 0 for binary files.
 */
export function estimateLines(size: number, language: string): number {
  if (!Number.isFinite(size) || size <= 0) return 0;
  const bytesPerLine = BYTES_PER_LINE.get(language) ?? DEFAULT_BYTES_PER_LINE;
  return Math.max(1, Math.round(size / bytesPerLine));
}
