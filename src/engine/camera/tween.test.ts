import type { CameraPose } from "@/state/explorer-store";
import { MIN_CAMERA_Y, poseFromSpherical, sphericalOf } from "./poses";
import {
  angleDelta,
  createTween,
  easeInOutCubic,
  easeOutCubic,
  interpolatePose,
  stepTween,
  transitionDuration,
  transitionLift,
} from "./tween";

const a: CameraPose = poseFromSpherical([0, 0, 0], { distance: 100, polar: 0.9, azimuth: 3 });
const b: CameraPose = poseFromSpherical([50, 0, 20], { distance: 10, polar: 0.6, azimuth: -3 });

describe("easing", () => {
  it("maps 0 -> 0 and 1 -> 1 monotonically", () => {
    for (const ease of [easeInOutCubic, easeOutCubic]) {
      expect(ease(0)).toBe(0);
      expect(ease(1)).toBe(1);
      let previous = 0;
      for (let t = 0; t <= 1; t += 0.05) {
        const value = ease(t);
        expect(value).toBeGreaterThanOrEqual(previous - 1e-12);
        previous = value;
      }
    }
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 9);
  });
});

describe("angleDelta", () => {
  it("takes the short way around", () => {
    expect(angleDelta(3, -3)).toBeCloseTo(2 * Math.PI - 6, 9);
    expect(angleDelta(0, Math.PI / 2)).toBeCloseTo(Math.PI / 2, 9);
    expect(Math.abs(angleDelta(0.1, 0.1 + 4 * Math.PI))).toBeLessThan(1e-9);
  });
});

describe("interpolatePose", () => {
  it("returns the exact end poses at t = 0 and t = 1", () => {
    expect(interpolatePose(a, b, 0)).toEqual(a);
    expect(interpolatePose(a, b, 1)).toEqual(b);
  });

  it("zooms geometrically and sweeps azimuth the short way", () => {
    const mid = sphericalOf(interpolatePose(a, b, 0.5));
    expect(mid.distance).toBeCloseTo(Math.sqrt(100 * 10), 6);
    // From 3 rad to -3 rad the short way crosses ±π, not 0.
    expect(Math.abs(Math.abs(mid.azimuth) - Math.PI)).toBeLessThan(0.01);
  });

  it("pulls back mid-flight when lifted", () => {
    const flat = sphericalOf(interpolatePose(a, b, 0.5));
    const lifted = sphericalOf(interpolatePose(a, b, 0.5, { lift: 0.5 }));
    expect(lifted.distance).toBeCloseTo(flat.distance * 1.5, 6);
  });

  it("never places the camera below the minimum altitude", () => {
    const low: CameraPose = { position: [0, 0.6, 50], target: [0, 5, 0] };
    const other: CameraPose = { position: [100, 0.6, 50], target: [100, 5, 0] };
    for (let t = 0.05; t < 1; t += 0.05) {
      expect(interpolatePose(low, other, t, { lift: 0.6 }).position[1]).toBeGreaterThanOrEqual(
        MIN_CAMERA_Y,
      );
    }
  });
});

describe("transition timing", () => {
  it("stays within 0.9–1.2 s", () => {
    expect(transitionDuration(a, a, 1000)).toBeCloseTo(0.9, 9);
    const far = poseFromSpherical([5000, 0, 5000], { distance: 1, polar: 0.5, azimuth: 0 });
    expect(transitionDuration(a, far, 1000)).toBeCloseTo(1.2, 9);
    const mid = transitionDuration(a, b, 1000);
    expect(mid).toBeGreaterThan(0.9);
    expect(mid).toBeLessThanOrEqual(1.2);
  });

  it("only lifts long flights", () => {
    expect(transitionLift(a, a)).toBe(0);
    const far = poseFromSpherical([2000, 0, 0], { distance: 20, polar: 0.8, azimuth: 0 });
    const near = poseFromSpherical([0, 0, 0], { distance: 20, polar: 0.8, azimuth: 0 });
    expect(transitionLift(near, far)).toBeGreaterThan(0);
    expect(transitionLift(near, far)).toBeLessThanOrEqual(0.6);
  });
});

describe("stepTween", () => {
  it("advances with time and finishes exactly on the target pose", () => {
    const tween = createTween(a, b, 1);
    const first = stepTween(tween, 0.25);
    expect(first.done).toBe(false);
    const second = stepTween(tween, 0.25);
    expect(sphericalOf(second.pose).distance).toBeLessThan(sphericalOf(first.pose).distance);
    const last = stepTween(tween, 10);
    expect(last.done).toBe(true);
    expect(last.pose).toEqual(b);
  });

  it("completes immediately with zero duration (reduced motion)", () => {
    const result = stepTween(createTween(a, b, 0), 0);
    expect(result.done).toBe(true);
    expect(result.pose).toEqual(b);
  });

  it("does not alias the caller's poses", () => {
    const from = { position: [1, 2, 3], target: [0, 0, 0] } as CameraPose;
    const tween = createTween(from, b, 1);
    from.position[0] = 999;
    expect(tween.from.position[0]).toBe(1);
  });
});
