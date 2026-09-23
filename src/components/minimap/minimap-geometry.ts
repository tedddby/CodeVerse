import type { WorldBounds } from "@/engine/layout/types";
import type { CameraPose } from "@/state/explorer-store";

/**
 * Pure transforms between world space (the XZ ground plane of the layout) and
 * minimap space (CSS pixels, origin top-left). World −Z is "north" (up on the
 * map) and +X is east (right), matching a top-down view of the city.
 */

export interface MinimapTransform {
  /** Side of the square minimap in CSS pixels. */
  size: number;
  /** CSS pixels per world unit. */
  scale: number;
  /** Pixel position of world (minX, minZ). */
  offsetX: number;
  offsetY: number;
  bounds: WorldBounds;
}

export interface Point2 {
  x: number;
  y: number;
}

export interface GroundPoint {
  x: number;
  z: number;
}

/** Fits the world bounds into a `size`×`size` square with `padding`, preserving aspect ratio. */
export function createMinimapTransform(
  bounds: WorldBounds,
  size: number,
  padding = 8,
): MinimapTransform {
  const width = Math.max(1e-6, bounds.maxX - bounds.minX);
  const depth = Math.max(1e-6, bounds.maxZ - bounds.minZ);
  const available = Math.max(1, size - 2 * padding);
  const scale = available / Math.max(width, depth);
  return {
    size,
    scale,
    offsetX: padding + (available - width * scale) / 2,
    offsetY: padding + (available - depth * scale) / 2,
    bounds,
  };
}

export function worldToMinimap(transform: MinimapTransform, x: number, z: number): Point2 {
  return {
    x: transform.offsetX + (x - transform.bounds.minX) * transform.scale,
    y: transform.offsetY + (z - transform.bounds.minZ) * transform.scale,
  };
}

/** Inverse of `worldToMinimap`, clamped to the world bounds. */
export function minimapToWorld(transform: MinimapTransform, px: number, py: number): GroundPoint {
  const { bounds } = transform;
  const x = bounds.minX + (px - transform.offsetX) / transform.scale;
  const z = bounds.minZ + (py - transform.offsetY) / transform.scale;
  return {
    x: Math.min(bounds.maxX, Math.max(bounds.minX, x)),
    z: Math.min(bounds.maxZ, Math.max(bounds.minZ, z)),
  };
}

export interface MinimapRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Converts a centre/extent rectangle (layout convention) to a top-left pixel rect. */
export function rectToMinimap(
  transform: MinimapTransform,
  centerX: number,
  centerZ: number,
  width: number,
  depth: number,
  minSize = 0,
): MinimapRect {
  const topLeft = worldToMinimap(transform, centerX - width / 2, centerZ - depth / 2);
  const pixelWidth = Math.max(minSize, width * transform.scale);
  const pixelHeight = Math.max(minSize, depth * transform.scale);
  // Keep tiny rects centred on their true position when enlarged to `minSize`.
  return {
    x: topLeft.x - (pixelWidth - width * transform.scale) / 2,
    y: topLeft.y - (pixelHeight - depth * transform.scale) / 2,
    width: pixelWidth,
    height: pixelHeight,
  };
}

export interface CameraFootprint {
  /** Camera position on the map. */
  position: Point2;
  /** Look-at point on the map. */
  target: Point2;
  /** View wedge corners (apex = position); null when looking straight down. */
  wedge: { left: Point2; right: Point2 } | null;
}

/**
 * Projects the camera onto the map: its position, look-at point and a view
 * wedge of `halfAngle` radians pointing from the position towards the target.
 * The wedge length follows the ground distance to the target, clamped to a
 * readable range.
 */
export function cameraFootprint(
  transform: MinimapTransform,
  pose: CameraPose,
  halfAngle = 0.55,
): CameraFootprint {
  const position = worldToMinimap(transform, pose.position[0], pose.position[2]);
  const target = worldToMinimap(transform, pose.target[0], pose.target[2]);
  const dx = target.x - position.x;
  const dy = target.y - position.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 1) return { position, target, wedge: null };
  const length = Math.min(transform.size * 0.45, Math.max(14, distance * 1.15));
  const angle = Math.atan2(dy, dx);
  const corner = (offset: number): Point2 => ({
    x: position.x + Math.cos(angle + offset) * length,
    y: position.y + Math.sin(angle + offset) * length,
  });
  return { position, target, wedge: { left: corner(-halfAngle), right: corner(halfAngle) } };
}

export type PanDirection = "north" | "south" | "east" | "west";

/**
 * Ground point reached by panning from `from` in `direction` by `fraction` of
 * the world size, clamped to the bounds (keyboard navigation of the minimap).
 */
export function panPoint(
  bounds: WorldBounds,
  from: GroundPoint,
  direction: PanDirection,
  fraction: number,
): GroundPoint {
  const step = Math.max(1e-6, bounds.size) * fraction;
  const dx = direction === "east" ? step : direction === "west" ? -step : 0;
  const dz = direction === "south" ? step : direction === "north" ? -step : 0;
  return {
    x: Math.min(bounds.maxX, Math.max(bounds.minX, from.x + dx)),
    z: Math.min(bounds.maxZ, Math.max(bounds.minZ, from.z + dz)),
  };
}

export function boundsCenter(bounds: WorldBounds): GroundPoint {
  return { x: (bounds.minX + bounds.maxX) / 2, z: (bounds.minZ + bounds.maxZ) / 2 };
}
