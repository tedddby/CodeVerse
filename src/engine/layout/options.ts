import type { LayoutOptions } from "./types";

/**
 * Default spatial constants of the city.
 *
 * Units are abstract world units. The values are tuned so that a typical
 * source file (a few KB, a few hundred lines) renders as a slender tower a few
 * units wide, directories read as terraces separated by visible "streets", and
 * a 25k-file repository still fits in a world a few hundred units across.
 */
export const DEFAULT_LAYOUT_OPTIONS: Readonly<LayoutOptions> = Object.freeze({
  districtPadding: 1.6,
  buildingGap: 0.6,
  minFootprint: 1.1,
  maxFootprint: 6.5,
  minHeight: 0.35,
  maxHeight: 30,
  slabHeight: 0.5,
});

function positiveOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function nonNegativeOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

/**
 * Merges user overrides with the defaults and repairs invalid values
 * (non-finite, negative, or min > max) so the layout never produces NaN geometry.
 */
export function resolveLayoutOptions(overrides?: Partial<LayoutOptions>): LayoutOptions {
  const defaults = DEFAULT_LAYOUT_OPTIONS;
  const source = overrides ?? {};
  const minFootprint = positiveOr(source.minFootprint, defaults.minFootprint);
  const minHeight = positiveOr(source.minHeight, defaults.minHeight);
  return {
    districtPadding: nonNegativeOr(source.districtPadding, defaults.districtPadding),
    buildingGap: nonNegativeOr(source.buildingGap, defaults.buildingGap),
    minFootprint,
    maxFootprint: Math.max(minFootprint, positiveOr(source.maxFootprint, defaults.maxFootprint)),
    minHeight,
    maxHeight: Math.max(minHeight, positiveOr(source.maxHeight, defaults.maxHeight)),
    slabHeight: positiveOr(source.slabHeight, defaults.slabHeight),
  };
}
