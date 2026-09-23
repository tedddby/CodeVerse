import type { BuildingLayout, WorldBounds } from "@/engine/layout/types";
import { mulberry32 } from "@/fixtures/fixture-builder";
import { CHUNKING_THRESHOLD, partitionBuildings } from "./chunking";

function randomCity(count: number, seed = 7): { buildings: BuildingLayout[]; bounds: WorldBounds } {
  const random = mulberry32(seed);
  const buildings: BuildingLayout[] = [];
  for (let i = 0; i < count; i += 1) {
    buildings.push({
      id: `file:f${i}`,
      districtId: "dir:",
      x: random() * 400 - 200,
      z: random() * 300 - 150,
      width: 1 + random() * 4,
      depth: 1 + random() * 4,
      height: 0.5 + random() * 30,
      baseY: random() * 3,
    });
  }
  return {
    buildings,
    bounds: { minX: -203, maxX: 203, minZ: -153, maxZ: 153, maxY: 34, size: 406 },
  };
}

function contains(
  chunk: { center: [number, number, number]; radius: number },
  b: BuildingLayout,
): boolean {
  for (const dx of [-b.width / 2, b.width / 2]) {
    for (const dz of [-b.depth / 2, b.depth / 2]) {
      for (const y of [b.baseY, b.baseY + b.height]) {
        const d = Math.hypot(
          b.x + dx - chunk.center[0],
          y - chunk.center[1],
          b.z + dz - chunk.center[2],
        );
        if (d > chunk.radius + 1e-6) return false;
      }
    }
  }
  return true;
}

describe("partitionBuildings", () => {
  it("returns nothing for an empty world", () => {
    expect(
      partitionBuildings([], { minX: 0, maxX: 0, minZ: 0, maxZ: 0, maxY: 0, size: 0 }),
    ).toEqual([]);
  });

  it("uses a single chunk up to the threshold", () => {
    const { buildings, bounds } = randomCity(CHUNKING_THRESHOLD);
    const chunks = partitionBuildings(buildings, bounds);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.indices).toHaveLength(CHUNKING_THRESHOLD);
  });

  it("splits large worlds so every building lands in exactly one chunk", () => {
    const { buildings, bounds } = randomCity(12_000);
    const chunks = partitionBuildings(buildings, bounds);
    expect(chunks.length).toBeGreaterThan(1);
    const seen = new Uint8Array(buildings.length);
    for (const chunk of chunks) {
      for (const i of chunk.indices) seen[i] = (seen[i] ?? 0) + 1;
    }
    expect(seen.every((n) => n === 1)).toBe(true);
  });

  it("produces bounding spheres enclosing every building box", () => {
    const { buildings, bounds } = randomCity(9_000);
    for (const chunk of partitionBuildings(buildings, bounds)) {
      for (const i of chunk.indices) {
        const b = buildings[i];
        if (b) expect(contains(chunk, b)).toBe(true);
      }
    }
  });

  it("keeps indices ascending and keys unique", () => {
    const { buildings, bounds } = randomCity(10_000);
    const chunks = partitionBuildings(buildings, bounds);
    expect(new Set(chunks.map((c) => c.key)).size).toBe(chunks.length);
    for (const chunk of chunks) {
      for (let i = 1; i < chunk.indices.length; i += 1) {
        expect((chunk.indices[i] ?? 0) > (chunk.indices[i - 1] ?? 0)).toBe(true);
      }
    }
  });

  it("is deterministic and respects custom thresholds", () => {
    const { buildings, bounds } = randomCity(600);
    const a = partitionBuildings(buildings, bounds, { threshold: 100, targetChunkSize: 50 });
    const b = partitionBuildings(buildings, bounds, { threshold: 100, targetChunkSize: 50 });
    expect(a.map((c) => [c.key, Array.from(c.indices)])).toEqual(
      b.map((c) => [c.key, Array.from(c.indices)]),
    );
    expect(a.length).toBeGreaterThan(4);
  });
});
