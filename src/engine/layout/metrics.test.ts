import { describe, expect, it } from "vitest";
import type { FileAnalysisStatus } from "@/graph/model/types";
import { DEFAULT_LAYOUT_OPTIONS } from "./compute-layout";
import { buildingFootprint, buildingHeight, FOOTPRINT_REFERENCE_BYTES } from "./metrics";

const options = DEFAULT_LAYOUT_OPTIONS;
const footprint = (size: number) => buildingFootprint({ size }, options);
const height = (lines: number, status: FileAnalysisStatus = "parsed") =>
  buildingHeight({ lines, status }, options);

describe("buildingFootprint", () => {
  it("is monotonic in bytes and clamped to the configured range", () => {
    const sizes = [0, 1, 100, 1_000, 4_096, 20_000, FOOTPRINT_REFERENCE_BYTES, 10_000_000];
    const values = sizes.map(footprint);
    for (let index = 1; index < values.length; index += 1) {
      expect(values[index]).toBeGreaterThanOrEqual(values[index - 1] ?? 0);
    }
    expect(footprint(0)).toBe(options.minFootprint);
    expect(footprint(FOOTPRINT_REFERENCE_BYTES)).toBeCloseTo(options.maxFootprint, 10);
    expect(footprint(10_000_000)).toBe(options.maxFootprint);
  });

  it("follows a square-root scale (ground area grows linearly with size)", () => {
    const extra = (size: number) => footprint(size) - options.minFootprint;
    expect(extra(16_000) / extra(4_000)).toBeCloseTo(2, 10);
  });

  it("treats invalid sizes as empty", () => {
    expect(footprint(Number.NaN)).toBe(options.minFootprint);
    expect(footprint(-50)).toBe(options.minFootprint);
    expect(footprint(Number.POSITIVE_INFINITY)).toBe(options.minFootprint);
  });
});

describe("buildingHeight", () => {
  it("is strictly monotonic in lines and never exceeds the maximum", () => {
    const lines = [1, 10, 100, 1_000, 10_000, 50_000, 1_000_000];
    const values = lines.map((value) => height(value));
    for (let index = 1; index < values.length; index += 1) {
      expect(values[index]).toBeGreaterThan(values[index - 1] ?? 0);
    }
    for (const value of values) {
      expect(value).toBeGreaterThan(options.minHeight);
      expect(value).toBeLessThan(options.maxHeight);
    }
  });

  it("clearly separates 100 from 1,000 lines without letting 50k lines dwarf everything", () => {
    expect(height(1_000) / height(100)).toBeGreaterThan(1.8);
    expect(height(50_000) / height(1_000)).toBeLessThan(2.2);
  });

  it("gives binary and empty files a low minimum", () => {
    expect(height(0)).toBe(options.minHeight);
    expect(height(5_000, "binary")).toBe(options.minHeight);
    expect(height(Number.NaN)).toBe(options.minHeight);
    expect(height(1)).toBeGreaterThan(options.minHeight);
  });

  it("uses the same scale for estimated line counts", () => {
    expect(height(400, "metadata-only")).toBe(height(400, "parsed"));
  });

  it("honours custom ranges", () => {
    const custom = { ...options, minHeight: 2, maxHeight: 4 };
    expect(buildingHeight({ lines: 0, status: "parsed" }, custom)).toBe(2);
    expect(buildingHeight({ lines: 1e9, status: "parsed" }, custom)).toBeLessThan(4);
    expect(buildingHeight({ lines: 1e9, status: "parsed" }, custom)).toBeGreaterThan(3.9);
  });
});

describe("generated files", () => {
  it("never tower over the skyline", () => {
    const lockfile = { lines: 6_400, status: "content-only" as const, isGenerated: true };
    const source = { lines: 300, status: "parsed" as const, isGenerated: false };
    expect(buildingHeight(lockfile, DEFAULT_LAYOUT_OPTIONS)).toBeLessThan(
      buildingHeight(source, DEFAULT_LAYOUT_OPTIONS),
    );
    expect(buildingHeight(lockfile, DEFAULT_LAYOUT_OPTIONS)).toBeGreaterThan(DEFAULT_LAYOUT_OPTIONS.minHeight);
  });
});
