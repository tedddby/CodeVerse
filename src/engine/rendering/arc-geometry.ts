import type { Rgb } from "./palette";

/**
 * Dependency arcs as one merged LineSegments buffer: a quadratic Bézier from
 * the top of the importing building to the top of the imported one, lifted
 * proportionally to the distance it spans. Direction is encoded as a color
 * gradient (source -> target) and by a dash that flows toward the target,
 * driven by the `progress` attribute and a time uniform in the shader.
 */

export type Point3 = readonly [number, number, number];

export interface ArcSpec {
  from: Point3;
  to: Point3;
  colorFrom: Rgb;
  colorTo: Rgb;
  /** 0..1 brightness multiplier (selection edges bright, overview edges dimmer). */
  intensity: number;
}

export interface ArcBuffers {
  /** xyz per vertex; two vertices per segment. */
  positions: Float32Array;
  /** Linear rgb per vertex (already multiplied by intensity). */
  colors: Float32Array;
  /** Per vertex: [progress along the arc 0..1, arc length in world units, intensity]. */
  arcData: Float32Array;
  vertexCount: number;
}

export interface ArcOptions {
  /** Line segments per arc (more = smoother, more vertices). */
  segments?: number;
  /** Lift as a fraction of the horizontal span. */
  liftFactor?: number;
  minLift?: number;
  maxLift?: number;
}

export const DEFAULT_ARC_SEGMENTS = 20;

/** Apex control point of an arc: above the midpoint, higher for longer spans. */
export function arcControlPoint(from: Point3, to: Point3, options: ArcOptions = {}): Point3 {
  const span = Math.hypot(to[0] - from[0], to[2] - from[2]);
  const lift = Math.min(
    options.maxLift ?? Number.POSITIVE_INFINITY,
    Math.max(options.minLift ?? 0.5, span * (options.liftFactor ?? 0.4)),
  );
  return [(from[0] + to[0]) / 2, Math.max(from[1], to[1]) + lift, (from[2] + to[2]) / 2];
}

/** Point on a quadratic Bézier at t. */
export function quadraticPoint(
  a: Point3,
  control: Point3,
  b: Point3,
  t: number,
): [number, number, number] {
  const u = 1 - t;
  const w0 = u * u;
  const w1 = 2 * u * t;
  const w2 = t * t;
  return [
    w0 * a[0] + w1 * control[0] + w2 * b[0],
    w0 * a[1] + w1 * control[1] + w2 * b[1],
    w0 * a[2] + w1 * control[2] + w2 * b[2],
  ];
}

export function buildArcBuffers(arcs: readonly ArcSpec[], options: ArcOptions = {}): ArcBuffers {
  const segments = Math.max(2, Math.floor(options.segments ?? DEFAULT_ARC_SEGMENTS));
  const vertexCount = arcs.length * segments * 2;
  const positions = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  const arcData = new Float32Array(vertexCount * 3);
  const points: Array<[number, number, number]> = new Array(segments + 1);
  const cumulative = new Float64Array(segments + 1);

  let vertex = 0;
  for (const arc of arcs) {
    const control = arcControlPoint(arc.from, arc.to, options);
    for (let s = 0; s <= segments; s += 1)
      points[s] = quadraticPoint(arc.from, control, arc.to, s / segments);
    cumulative[0] = 0;
    for (let s = 1; s <= segments; s += 1) {
      const p = points[s];
      const q = points[s - 1];
      cumulative[s] =
        (cumulative[s - 1] ?? 0) + (p && q ? Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) : 0);
    }
    const length = cumulative[segments] ?? 0;
    const intensity = Math.min(1, Math.max(0, arc.intensity));

    for (let s = 0; s < segments; s += 1) {
      for (const end of [s, s + 1]) {
        const p = points[end];
        if (!p) continue;
        const t = length > 0 ? (cumulative[end] ?? 0) / length : end / segments;
        positions[vertex * 3] = p[0];
        positions[vertex * 3 + 1] = p[1];
        positions[vertex * 3 + 2] = p[2];
        colors[vertex * 3] =
          (arc.colorFrom[0] + (arc.colorTo[0] - arc.colorFrom[0]) * t) * intensity;
        colors[vertex * 3 + 1] =
          (arc.colorFrom[1] + (arc.colorTo[1] - arc.colorFrom[1]) * t) * intensity;
        colors[vertex * 3 + 2] =
          (arc.colorFrom[2] + (arc.colorTo[2] - arc.colorFrom[2]) * t) * intensity;
        arcData[vertex * 3] = t;
        arcData[vertex * 3 + 1] = length;
        arcData[vertex * 3 + 2] = intensity;
        vertex += 1;
      }
    }
  }

  return { positions, colors, arcData, vertexCount };
}
