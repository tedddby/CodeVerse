import {
  paintersOrder,
  type PosterBuilding,
  type PosterDistrict,
  type PosterScene,
} from "@/components/landing/demo/poster-scene";
import { byDepth, desaturateHex } from "@/components/landing/iso";
import { getLanguageColor } from "@/lib/languages/registry";
import { projectScene, type CityGeometry } from "./city-geometry";

/**
 * Tiny isometric thumbnails for the example repositories. They are drawn, not
 * analyzed: each one sketches the shape the example card describes (packages
 * as districts, a dominant tower, parsed vs. sized code, directory-first
 * slabs), in the explorer's language colors.
 */

const SLAB = 0.35;

/** Small deterministic PRNG so thumbnails are identical on every render. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface DistrictSpec {
  x: number;
  z: number;
  width: number;
  depth: number;
  /** Buildings per row and column; 0 draws a bare slab. */
  grid: number;
  color: string;
  /** Height range of buildings. */
  heights: [number, number];
}

function buildScene(id: string, seed: number, specs: readonly DistrictSpec[]): PosterScene {
  const next = random(seed);
  const districts: PosterDistrict[] = specs.map((spec, index) => ({
    id: `${id}-d${index}`,
    level: 1,
    x: spec.x,
    z: spec.z,
    width: spec.width,
    depth: spec.depth,
    height: SLAB,
    baseY: 0,
  }));
  const buildings: PosterBuilding[] = [];
  specs.forEach((spec, index) => {
    if (spec.grid === 0) return;
    const cellW = spec.width / spec.grid;
    const cellD = spec.depth / spec.grid;
    for (let row = 0; row < spec.grid; row += 1) {
      for (let column = 0; column < spec.grid; column += 1) {
        if (next() < 0.18) continue;
        const [low, high] = spec.heights;
        buildings.push({
          id: `${id}-b${index}-${row}-${column}`,
          color: spec.color,
          x: spec.x - spec.width / 2 + cellW * (column + 0.5),
          z: spec.z - spec.depth / 2 + cellD * (row + 0.5),
          width: cellW * 0.62,
          depth: cellD * 0.62,
          height: low + (high - low) * next() ** 1.6,
          baseY: SLAB,
        });
      }
    }
  });
  return { districts: districts.sort(byDepth), buildings: paintersOrder(buildings) };
}

const JS = getLanguageColor("javascript");
const TS = getLanguageColor("typescript");
const CPP = getLanguageColor("cpp");
const C = getLanguageColor("c");

function reactScene(): PosterScene {
  // packages/: many similar districts in a grid.
  const specs: DistrictSpec[] = [];
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      specs.push({
        x: column * 4.2,
        z: row * 4.2,
        width: 3.4,
        depth: 3.4,
        grid: 3,
        color: JS,
        heights: [0.6, row + column === 2 ? 4.2 : 2.4],
      });
    }
  }
  return buildScene("react", 7, specs);
}

function nextScene(): PosterScene {
  return buildScene("next", 11, [
    // packages/next: a dense block with tall towers.
    { x: 0, z: 0, width: 5, depth: 5, grid: 3, color: TS, heights: [2.5, 7.5] },
    // test/: sprawling and low.
    {
      x: 7.2,
      z: 0.6,
      width: 6.4,
      depth: 7.4,
      grid: 6,
      color: desaturateHex(TS, 0.35),
      heights: [0.4, 1.3],
    },
    { x: 0.4, z: 6.4, width: 4.2, depth: 3.4, grid: 3, color: TS, heights: [0.5, 1.8] },
  ]);
}

function nodeScene(): PosterScene {
  return buildScene("node", 5, [
    // lib/: parsed JavaScript.
    { x: 0, z: 0, width: 5.2, depth: 5.2, grid: 4, color: JS, heights: [0.6, 3.2] },
    // src/: C++ runtime, sized but not parsed.
    { x: 6.6, z: 0, width: 4.6, depth: 5.2, grid: 3, color: CPP, heights: [1, 4.4] },
    // deps/: vendored, muted.
    {
      x: 0.6,
      z: 6.8,
      width: 11.4,
      depth: 4.2,
      grid: 5,
      color: desaturateHex(C, 0.7),
      heights: [0.4, 2.2],
    },
  ]);
}

function linuxScene(): PosterScene {
  // Directory-first: districts only, terraced by size.
  const specs: DistrictSpec[] = [
    { x: 0, z: 0, width: 7, depth: 6, grid: 0, color: C, heights: [0, 0] },
    { x: 8.2, z: -0.5, width: 5, depth: 5, grid: 0, color: C, heights: [0, 0] },
    { x: 0.5, z: 7.2, width: 5.8, depth: 4.2, grid: 0, color: C, heights: [0, 0] },
    { x: 7.6, z: 5.6, width: 3.6, depth: 3.6, grid: 0, color: C, heights: [0, 0] },
    { x: 11.4, z: 5.2, width: 2.4, depth: 2.8, grid: 0, color: C, heights: [0, 0] },
    { x: 6.8, z: 9.6, width: 3.2, depth: 2.4, grid: 0, color: C, heights: [0, 0] },
  ];
  const scene = buildScene("linux", 3, specs);
  // Taller slabs for bigger directories, like directory-first mode's terraces.
  scene.districts = scene.districts.map((district) => ({
    ...district,
    height: 0.35 + Math.sqrt(district.width * district.depth) * 0.22,
  }));
  return scene;
}

const SCENES: Readonly<Record<string, () => PosterScene>> = {
  "facebook/react": reactScene,
  "vercel/next.js": nextScene,
  "nodejs/node": nodeScene,
  "torvalds/linux": linuxScene,
};

const cache = new Map<string, CityGeometry | null>();

/** Thumbnail geometry for a configured example, or null when none is drawn. */
export function exampleThumbnail(fullName: string): CityGeometry | null {
  if (cache.has(fullName)) return cache.get(fullName) ?? null;
  const scene = SCENES[fullName]?.();
  const geometry = scene ? projectScene(scene, { targetWidth: 320, padding: 4 }) : null;
  cache.set(fullName, geometry);
  return geometry;
}
