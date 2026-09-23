/**
 * Fuzzy subsequence scoring in the spirit of VS Code quick open and fzf.
 *
 * A query matches a target when every query character appears in the target in
 * order (case-insensitive). Among all such alignments the best-scoring one is
 * chosen with a small dynamic program:
 *
 * - every matched character earns a base score,
 * - characters at "word starts" earn a bonus (start of string, after a path
 *   separator, after `.` `_` `-` and other delimiters, camelCase humps, digits),
 * - consecutive matches earn a bonus, gaps between matches cost a penalty,
 * - the first query character's boundary bonus counts double,
 * - matching the query's exact letter case earns a tiny bonus.
 *
 * The hot path (`fuzzyScore`) allocates nothing: it reuses module-level typed
 * arrays and only keeps two DP rows. `fuzzyMatch` additionally reconstructs the
 * matched character positions and is meant for the handful of displayed results.
 */

export const NO_MATCH = Number.NEGATIVE_INFINITY;

/** Longest query (in characters) considered; the rest is ignored. */
export const MAX_QUERY_LENGTH = 64;
/** Longest target considered; longer targets are scored on their last characters. */
export const MAX_TARGET_LENGTH = 256;

const SCORE_MATCH = 16;
const SCORE_GAP_START = -3;
const SCORE_GAP_EXTENSION = -1;
const SCORE_CASE_MATCH = 1;

const BONUS_START = 10;
const BONUS_SEPARATOR = 9;
const BONUS_DELIMITER = 8;
const BONUS_CAMEL = 7;
const BONUS_CONSECUTIVE = 5;
const FIRST_CHAR_BONUS_MULTIPLIER = 2;

const NEG = -1_000_000_000;

export interface PreparedQuery {
  /** Query as typed, without whitespace (used for the case bonus). */
  original: string;
  /** Lower-case query without whitespace. */
  lower: string;
}

/** Normalizes a raw query: strips whitespace, unifies path separators, caps the length. */
export function prepareQuery(raw: string): PreparedQuery {
  const original = raw.replace(/\s+/g, "").replace(/\\/g, "/").slice(0, MAX_QUERY_LENGTH);
  return { original, lower: original.toLowerCase() };
}

/**
 * Upper bound of `fuzzyScore` for a query of `length` characters: every char
 * matched with the strongest bonus, consecutively and with the exact case.
 * Lets callers skip scoring entries that cannot enter a bounded top-K.
 */
export function maxFuzzyScore(length: number): number {
  if (length <= 0) return 0;
  const first = SCORE_MATCH + BONUS_START * FIRST_CHAR_BONUS_MULTIPLIER + SCORE_CASE_MATCH;
  return first + (length - 1) * (SCORE_MATCH + BONUS_START + SCORE_CASE_MATCH);
}

/**
 * 32-bit summary of which characters occur in a lower-case string: a–z map to
 * bits 0–25, digits share bits 26–30, "/" is bit 31; other characters are not
 * tracked. If `(mask(target) & mask(query)) !== mask(query)` the query cannot be
 * a subsequence of the target, which rejects most entries without touching strings.
 */
export function characterMask(lower: string): number {
  let mask = 0;
  for (let i = 0; i < lower.length; i += 1) {
    const code = lower.charCodeAt(i);
    if (code >= 97 && code <= 122) mask |= 1 << (code - 97);
    else if (code >= 48 && code <= 57) mask |= 1 << (26 + ((code - 48) % 5));
    else if (code === 47) mask |= 1 << 31;
  }
  return mask;
}

/** True when every character of `queryLower` occurs in `targetLower` in order. */
export function isSubsequence(queryLower: string, targetLower: string): boolean {
  let position = 0;
  for (let i = 0; i < queryLower.length; i += 1) {
    position = targetLower.indexOf(queryLower.charAt(i), position);
    if (position === -1) return false;
    position += 1;
  }
  return true;
}

function isUpper(code: number): boolean {
  return code >= 65 && code <= 90;
}

function isLower(code: number): boolean {
  return code >= 97 && code <= 122;
}

function isDigit(code: number): boolean {
  return code >= 48 && code <= 57;
}

function isDelimiter(code: number): boolean {
  switch (code) {
    case 32: // space
    case 35: // #
    case 36: // $
    case 40: // (
    case 44: // ,
    case 45: // -
    case 46: // .
    case 58: // :
    case 60: // <
    case 64: // @
    case 95: // _
      return true;
    default:
      return false;
  }
}

/** Bonus for matching the character at `index`, based on its neighbourhood. */
function positionBonus(target: string, index: number, start: number): number {
  if (index === start) return BONUS_START;
  const previous = target.charCodeAt(index - 1);
  if (previous === 47 || previous === 92) return BONUS_SEPARATOR;
  if (isDelimiter(previous)) return BONUS_DELIMITER;
  const current = target.charCodeAt(index);
  if (isUpper(current) && isLower(previous)) return BONUS_CAMEL;
  if (isDigit(current) && !isDigit(previous)) return BONUS_CAMEL;
  return 0;
}

// Reusable buffers for the allocation-free scorer: DP scores and the boundary
// bonus carried by the consecutive run ending in each cell (fzf-style).
const bonusBuffer = new Int32Array(MAX_TARGET_LENGTH);
let previousRow = new Int32Array(MAX_TARGET_LENGTH);
let currentRow = new Int32Array(MAX_TARGET_LENGTH);
let previousRun = new Int32Array(MAX_TARGET_LENGTH);
let currentRun = new Int32Array(MAX_TARGET_LENGTH);

interface CellScore {
  score: number;
  /** Boundary bonus carried by the consecutive run ending in this cell. */
  run: number;
  consecutive: boolean;
}

const cell: CellScore = { score: NEG, run: 0, consecutive: false };

/**
 * Shared recurrence for one DP cell where query char `i > 0` matches the target.
 * Writes into the module-level `cell` to stay allocation-free.
 */
function scoreCell(
  diagonal: number,
  diagonalRun: number,
  gapBest: number,
  bonus: number,
  caseBonus: number,
): void {
  const runBonus = Math.max(diagonalRun, bonus);
  const consecutive =
    diagonal > NEG ? diagonal + SCORE_MATCH + Math.max(runBonus, BONUS_CONSECUTIVE) : NEG;
  const gapped = gapBest > NEG / 2 ? gapBest + SCORE_MATCH + bonus : NEG;
  if (consecutive === NEG && gapped === NEG) {
    cell.score = NEG;
    cell.run = 0;
    cell.consecutive = false;
  } else if (consecutive >= gapped) {
    cell.score = consecutive + caseBonus;
    cell.run = runBonus;
    cell.consecutive = true;
  } else {
    cell.score = gapped + caseBonus;
    cell.run = bonus;
    cell.consecutive = false;
  }
}

/**
 * Scores `target` against a prepared query. Returns `NO_MATCH` when the query
 * is not a subsequence of the target. `targetLower` must be `target.toLowerCase()`
 * (precomputed by callers so it is not recomputed per query).
 */
export function fuzzyScore(query: PreparedQuery, target: string, targetLower: string): number {
  const m = query.lower.length;
  if (m === 0) return 0;
  const start = Math.max(0, target.length - MAX_TARGET_LENGTH);
  if (target.length - start < m) return NO_MATCH;

  // Narrow the DP to [first possible start, last possible end].
  const first = targetLower.indexOf(query.lower.charAt(0), start);
  if (first === -1) return NO_MATCH;
  let cursor = first + 1;
  for (let i = 1; i < m; i += 1) {
    cursor = targetLower.indexOf(query.lower.charAt(i), cursor);
    if (cursor === -1) return NO_MATCH;
    cursor += 1;
  }
  const last = targetLower.lastIndexOf(query.lower.charAt(m - 1));

  for (let j = first; j <= last; j += 1) bonusBuffer[j - start] = positionBonus(target, j, start);

  let best = NO_MATCH;
  for (let i = 0; i < m; i += 1) {
    const queryCode = query.lower.charCodeAt(i);
    const originalCode = query.original.charCodeAt(i);
    let gapBest = NEG;
    const isLastRow = i === m - 1;
    for (let j = first; j <= last; j += 1) {
      const k = j - start;
      if (i > 0 && j - 2 >= first) {
        gapBest = Math.max(
          gapBest + SCORE_GAP_EXTENSION,
          (previousRow[k - 2] ?? NEG) + SCORE_GAP_START,
        );
      }
      let score = NEG;
      let run = 0;
      if (j - first >= i && targetLower.charCodeAt(j) === queryCode) {
        const bonus = bonusBuffer[k] ?? 0;
        const caseBonus = target.charCodeAt(j) === originalCode ? SCORE_CASE_MATCH : 0;
        if (i === 0) {
          score = SCORE_MATCH + bonus * FIRST_CHAR_BONUS_MULTIPLIER + caseBonus;
          run = bonus;
        } else {
          const hasDiagonal = j - 1 >= first;
          scoreCell(
            hasDiagonal ? (previousRow[k - 1] ?? NEG) : NEG,
            hasDiagonal ? (previousRun[k - 1] ?? 0) : 0,
            gapBest,
            bonus,
            caseBonus,
          );
          score = cell.score;
          run = cell.run;
        }
      }
      currentRow[k] = score;
      currentRun[k] = run;
      if (isLastRow && score > best) best = score;
    }
    const swapRow = previousRow;
    previousRow = currentRow;
    currentRow = swapRow;
    const swapRun = previousRun;
    previousRun = currentRun;
    currentRun = swapRun;
  }
  return best > NEG / 2 ? best : NO_MATCH;
}

export interface FuzzyMatchResult {
  score: number;
  /** Indices into `target` of the matched characters, ascending. */
  positions: number[];
}

/**
 * Same scoring as `fuzzyScore`, but also returns the matched positions of the
 * best alignment. Allocates O(query × target) memory; use for displayed results only.
 */
export function fuzzyMatch(
  query: PreparedQuery,
  target: string,
  targetLower: string,
): FuzzyMatchResult | null {
  const m = query.lower.length;
  if (m === 0) return { score: 0, positions: [] };
  const start = Math.max(0, target.length - MAX_TARGET_LENGTH);
  const n = target.length - start;
  if (n < m || !isSubsequence(query.lower, start > 0 ? targetLower.slice(start) : targetLower))
    return null;

  const scores = new Int32Array(m * n).fill(NEG);
  const runs = new Int32Array(m * n);
  // For each cell: -1 = consecutive (came from column - 1), otherwise the previous match column.
  const from = new Int32Array(m * n).fill(-2);
  const bonuses = new Int32Array(n);
  for (let k = 0; k < n; k += 1) bonuses[k] = positionBonus(target, k + start, start);

  for (let i = 0; i < m; i += 1) {
    const queryCode = query.lower.charCodeAt(i);
    const originalCode = query.original.charCodeAt(i);
    let gapBest = NEG;
    let gapFrom = -2;
    for (let k = 0; k < n; k += 1) {
      if (i > 0 && k >= 2) {
        const extended = gapBest + SCORE_GAP_EXTENSION;
        const opened = (scores[(i - 1) * n + k - 2] ?? NEG) + SCORE_GAP_START;
        if (opened >= extended) {
          gapBest = opened;
          gapFrom = k - 2;
        } else {
          gapBest = extended;
        }
      }
      if (k < i || targetLower.charCodeAt(k + start) !== queryCode) continue;
      const bonus = bonuses[k] ?? 0;
      const caseBonus = target.charCodeAt(k + start) === originalCode ? SCORE_CASE_MATCH : 0;
      if (i === 0) {
        scores[k] = SCORE_MATCH + bonus * FIRST_CHAR_BONUS_MULTIPLIER + caseBonus;
        runs[k] = bonus;
        continue;
      }
      scoreCell(
        k >= 1 ? (scores[(i - 1) * n + k - 1] ?? NEG) : NEG,
        k >= 1 ? (runs[(i - 1) * n + k - 1] ?? 0) : 0,
        gapBest,
        bonus,
        caseBonus,
      );
      if (cell.score === NEG) continue;
      scores[i * n + k] = cell.score;
      runs[i * n + k] = cell.run;
      from[i * n + k] = cell.consecutive ? -1 : gapFrom;
    }
  }

  let bestScore = NEG;
  let bestColumn = -1;
  for (let k = 0; k < n; k += 1) {
    const score = scores[(m - 1) * n + k] ?? NEG;
    if (score > bestScore) {
      bestScore = score;
      bestColumn = k;
    }
  }
  if (bestColumn === -1 || bestScore <= NEG / 2) return null;

  const positions = new Array<number>(m);
  let column = bestColumn;
  for (let i = m - 1; i >= 0; i -= 1) {
    positions[i] = column + start;
    const origin = from[i * n + column] ?? -2;
    column = origin === -1 ? column - 1 : origin;
  }
  return { score: bestScore, positions };
}
