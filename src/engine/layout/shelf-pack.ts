/**
 * Shelf packing of square cells with column stacking.
 *
 * Cells are placed strictly in the given order (the order carries meaning:
 * dependency-related files are consecutive), left to right in rows ("shelves")
 * of at most `maxWidth`. A row is as tall as its tallest cell; when a cell is
 * not taller than the space left below the current column, it is stacked in
 * that column instead of opening a new one, which recovers most of the space a
 * plain shelf algorithm wastes under tall cells.
 *
 * Guarantees: cells never overlap, every cell lies within [0, width] x [0, height]
 * of the packing, and `width <= maxWidth`. O(n) time.
 */

const EPSILON = 1e-9;

export interface ShelfPacking {
  /** Widest row. Never exceeds the requested `maxWidth`. */
  width: number;
  /** Sum of row heights. */
  height: number;
  rowTop: Float64Array;
  rowHeight: Float64Array;
  rowWidth: Float64Array;
  rowColumnCount: Int32Array;
  /** Per cell: row index, column index within the row, and top-left offset. */
  cellRow: Int32Array;
  cellColumn: Int32Array;
  /** X of the cell's left edge (already centred within its column). */
  cellX: Float64Array;
  /** Y of the cell's top edge, relative to its row's top. */
  cellY: Float64Array;
}

interface ShelfRecorder {
  place(cell: number, row: number, column: number, x: number, y: number): void;
  closeRow(row: number, top: number, height: number, width: number, columns: number): void;
}

/** Core loop shared by the measuring and the recording variants. Returns the total height. */
function runShelf(
  sides: ArrayLike<number>,
  maxWidth: number,
  recorder: ShelfRecorder | null,
): { width: number; height: number } {
  let rowIndex = 0;
  let rowTop = 0;
  let rowHeight = 0;
  let rowX = 0;
  let columnIndex = -1;
  let columnX = 0;
  let columnWidth = 0;
  let columnFill = 0;
  let widest = 0;

  for (let cell = 0; cell < sides.length; cell += 1) {
    const side = sides[cell] ?? 0;
    if (side > maxWidth + EPSILON)
      return { width: Number.POSITIVE_INFINITY, height: Number.POSITIVE_INFINITY };

    // 1. Stack below the previous cell of the current column.
    if (
      columnIndex >= 0 &&
      side <= columnWidth + EPSILON &&
      columnFill + side <= rowHeight + EPSILON
    ) {
      recorder?.place(cell, rowIndex, columnIndex, columnX + (columnWidth - side) / 2, columnFill);
      columnFill += side;
      continue;
    }
    // 2. Open a new column in the current row.
    if (columnIndex < 0 || rowX + side <= maxWidth + EPSILON) {
      columnIndex += 1;
      columnX = rowX;
      columnWidth = side;
      columnFill = side;
      rowX += side;
      if (side > rowHeight) rowHeight = side;
      recorder?.place(cell, rowIndex, columnIndex, columnX, 0);
      continue;
    }
    // 3. Close the row and open a new one.
    recorder?.closeRow(rowIndex, rowTop, rowHeight, rowX, columnIndex + 1);
    if (rowX > widest) widest = rowX;
    rowTop += rowHeight;
    rowIndex += 1;
    columnIndex = 0;
    columnX = 0;
    columnWidth = side;
    columnFill = side;
    rowX = side;
    rowHeight = side;
    recorder?.place(cell, rowIndex, 0, 0, 0);
  }

  if (columnIndex < 0) return { width: 0, height: 0 };
  recorder?.closeRow(rowIndex, rowTop, rowHeight, rowX, columnIndex + 1);
  if (rowX > widest) widest = rowX;
  return { width: Math.min(widest, maxWidth), height: rowTop + rowHeight };
}

/** Height of the packing for a given width, or +Infinity if a cell is wider than `maxWidth`. */
export function shelfPackHeight(sides: ArrayLike<number>, maxWidth: number): number {
  return runShelf(sides, maxWidth, null).height;
}

/** Full packing with per-cell placement, or null if a cell is wider than `maxWidth`. */
export function shelfPack(sides: ArrayLike<number>, maxWidth: number): ShelfPacking | null {
  const count = sides.length;
  const cellRow = new Int32Array(count);
  const cellColumn = new Int32Array(count);
  const cellX = new Float64Array(count);
  const cellY = new Float64Array(count);
  const rows: Array<{ top: number; height: number; width: number; columns: number }> = [];
  const result = runShelf(sides, maxWidth, {
    place(cell, row, column, x, y) {
      cellRow[cell] = row;
      cellColumn[cell] = column;
      cellX[cell] = x;
      cellY[cell] = y;
    },
    closeRow(_row, top, height, width, columns) {
      rows.push({ top, height, width, columns });
    },
  });
  if (!Number.isFinite(result.height)) return null;
  return {
    width: result.width,
    height: result.height,
    rowTop: Float64Array.from(rows, (row) => row.top),
    rowHeight: Float64Array.from(rows, (row) => row.height),
    rowWidth: Float64Array.from(rows, (row) => row.width),
    rowColumnCount: Int32Array.from(rows, (row) => row.columns),
    cellRow,
    cellColumn,
    cellX,
    cellY,
  };
}

/**
 * Smallest side `s` (to a relative precision of ~0.1%) such that the cells pack
 * into an `s x s` square. Used to size a district's file block before the
 * treemap assigns it an actual rectangle.
 */
export function minimalSquareSide(sides: ArrayLike<number>): number {
  let area = 0;
  let largest = 0;
  for (let index = 0; index < sides.length; index += 1) {
    const side = sides[index] ?? 0;
    area += side * side;
    if (side > largest) largest = side;
  }
  if (sides.length === 0) return 0;
  let low = Math.max(largest, Math.sqrt(area));
  if (shelfPackHeight(sides, low) <= low + EPSILON) return low;
  let high = low * 1.2;
  // A single row of all cells is always feasible once high >= total width, so this terminates.
  while (shelfPackHeight(sides, high) > high + EPSILON) {
    low = high;
    high *= 1.2;
  }
  for (let step = 0; step < 10; step += 1) {
    const middle = (low + high) / 2;
    if (shelfPackHeight(sides, middle) <= middle + EPSILON) high = middle;
    else low = middle;
  }
  return high;
}
