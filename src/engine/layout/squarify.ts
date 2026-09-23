import type { Rect } from "./geometry";

/**
 * Squarified treemap (Bruls, Huizing & van Wijk, 2000).
 *
 * Splits `rect` into one rectangle per weight, with areas proportional to the
 * weights, filling `rect` exactly. Items are laid out in rows along the shorter
 * side of the remaining space; an item joins the current row only while that
 * does not worsen the row's worst aspect ratio, which keeps rectangles close to
 * square (no slivers).
 *
 * For good aspect ratios `weights` should be sorted in decreasing order (the
 * caller controls ordering so ties can be broken deterministically). Weights
 * must be positive and finite; non-positive weights get an empty rectangle.
 * Runs in O(n). Returns rectangles in the same order as `weights`.
 */
export function squarify(weights: readonly number[], rect: Rect): Rect[] {
  const count = weights.length;
  const result: Rect[] = new Array<Rect>(count);
  let total = 0;
  for (const weight of weights) if (weight > 0 && Number.isFinite(weight)) total += weight;

  let x = rect.x;
  let z = rect.z;
  let width = Math.max(0, rect.width);
  let depth = Math.max(0, rect.depth);
  if (total <= 0 || width <= 0 || depth <= 0) {
    for (let index = 0; index < count; index += 1) result[index] = { x, z, width: 0, depth: 0 };
    return result;
  }

  const scale = (width * depth) / total;
  const areaOf = (index: number) => {
    const weight = weights[index] ?? 0;
    return weight > 0 && Number.isFinite(weight) ? weight * scale : 0;
  };

  let start = 0;
  while (start < count) {
    const shortSide = Math.min(width, depth);
    const shortSquared = shortSide * shortSide;
    const worst = (sum: number, min: number, max: number) => {
      const sumSquared = sum * sum;
      return Math.max((shortSquared * max) / sumSquared, sumSquared / (shortSquared * min));
    };

    // Grow the row greedily while the worst aspect ratio does not get worse.
    let end = start;
    let rowSum = 0;
    let rowMin = Number.POSITIVE_INFINITY;
    let rowMax = 0;
    let rowWorst = Number.POSITIVE_INFINITY;
    while (end < count) {
      const area = areaOf(end);
      if (area <= 0) {
        // Zero-weight items are carried along in the row and receive no area.
        end += 1;
        continue;
      }
      const nextSum = rowSum + area;
      const nextMin = Math.min(rowMin, area);
      const nextMax = Math.max(rowMax, area);
      const nextWorst = worst(nextSum, nextMin, nextMax);
      if (rowSum > 0 && nextWorst > rowWorst) break;
      rowSum = nextSum;
      rowMin = nextMin;
      rowMax = nextMax;
      rowWorst = nextWorst;
      end += 1;
    }

    const isLastRow = end >= count;
    if (width >= depth) {
      // Column on the left (x side), items stacked along z.
      const thickness = isLastRow || rowSum <= 0 ? width : Math.min(width, rowSum / depth);
      let cursor = z;
      for (let index = start; index < end; index += 1) {
        const area = areaOf(index);
        const isLastInRow = index === end - 1;
        const length = isLastInRow ? z + depth - cursor : rowSum > 0 ? (area / rowSum) * depth : 0;
        result[index] = { x, z: cursor, width: thickness, depth: Math.max(0, length) };
        cursor += length;
      }
      x += thickness;
      width = Math.max(0, width - thickness);
    } else {
      // Row on the top (z side), items laid out along x.
      const thickness = isLastRow || rowSum <= 0 ? depth : Math.min(depth, rowSum / width);
      let cursor = x;
      for (let index = start; index < end; index += 1) {
        const area = areaOf(index);
        const isLastInRow = index === end - 1;
        const length = isLastInRow ? x + width - cursor : rowSum > 0 ? (area / rowSum) * width : 0;
        result[index] = { x: cursor, z, width: Math.max(0, length), depth: thickness };
        cursor += length;
      }
      z += thickness;
      depth = Math.max(0, depth - thickness);
    }
    start = end;
  }
  return result;
}
