import type { CameraPose } from "@/state/explorer-store";
import {
  FRAME_MAX_POLAR,
  FRAME_MIN_POLAR,
  MAX_POLAR,
  MIN_CAMERA_Y,
  ORBIT_FALLBACK_POLAR,
  OVERVIEW_AZIMUTH,
  OVERVIEW_POLAR,
  clippingPlanes,
  distanceLimits,
  enclosingSphere,
  establishingPose,
  fitDistance,
  focusPointPose,
  framePose,
  legalOrbitTarget,
  lookTarget,
  orbitPolar,
  overviewPose,
  overviewTarget,
  poseFromSpherical,
  posesEqual,
  roundPose,
  sanitizePose,
  sphericalOf,
  type FrameSphere,
  type Vec3,
} from "./poses";

const view = { fovY: 45, aspect: 16 / 9 };
const frame: FrameSphere = { center: [10, 0, -5], radius: 100 };

describe("spherical round trip", () => {
  it("recovers distance, polar and azimuth", () => {
    const pose = poseFromSpherical([1, 2, 3], { distance: 50, polar: 0.7, azimuth: -2.1 });
    const s = sphericalOf(pose);
    expect(s.distance).toBeCloseTo(50, 9);
    expect(s.polar).toBeCloseTo(0.7, 9);
    expect(s.azimuth).toBeCloseTo(-2.1, 9);
  });
});

describe("fitDistance", () => {
  it("fits the sphere inside the limiting field of view", () => {
    const distance = fitDistance(10, { fovY: 60, aspect: 2 }, 1);
    // Vertical fov is limiting for wide viewports: sin(30°) = 0.5.
    expect(distance).toBeCloseTo(20, 9);
  });

  it("uses the horizontal fov on portrait viewports", () => {
    expect(fitDistance(10, { fovY: 60, aspect: 0.5 }, 1)).toBeGreaterThan(
      fitDistance(10, { fovY: 60, aspect: 2 }, 1),
    );
  });
});

describe("overviewPose / establishingPose", () => {
  it("looks at the (lowered) world centre from the canonical 3/4 angle", () => {
    const pose = overviewPose(frame, view);
    expect(pose.target).toEqual(overviewTarget(frame));
    expect(overviewTarget({ center: [1, 10, 2], radius: 5 })).toEqual([1, 3, 2]);
    const s = sphericalOf(pose);
    expect(s.polar).toBeCloseTo(OVERVIEW_POLAR, 9);
    expect(s.azimuth).toBeCloseTo(OVERVIEW_AZIMUTH, 9);
    expect(pose.position[1]).toBeGreaterThan(0);
  });

  it("starts the establishing shot higher and further away", () => {
    const start = sphericalOf(establishingPose(frame, view));
    const end = sphericalOf(overviewPose(frame, view));
    expect(start.distance).toBeGreaterThan(end.distance * 2);
    expect(start.polar).toBeLessThan(end.polar);
  });
});

describe("framePose", () => {
  const current = poseFromSpherical([0, 0, 0], { distance: 300, polar: 0.1, azimuth: 1.2 });

  it("keeps the current heading and clamps elevation into a readable range", () => {
    const pose = framePose({ center: [5, 3, 5], radius: 4 }, current, view);
    const s = sphericalOf(pose);
    expect(s.azimuth).toBeCloseTo(1.2, 9);
    expect(s.polar).toBeCloseTo(FRAME_MIN_POLAR, 9);
    expect(pose.target).toEqual([5, 3, 5]);
  });

  it("clamps grazing angles too", () => {
    const grazing = poseFromSpherical([0, 0, 0], { distance: 30, polar: 1.5, azimuth: 0 });
    expect(
      sphericalOf(framePose({ center: [0, 0, 0], radius: 2 }, grazing, view)).polar,
    ).toBeCloseTo(FRAME_MAX_POLAR, 9);
  });

  it("never gets closer than the minimum distance", () => {
    const pose = framePose({ center: [0, 0, 0], radius: 0.01 }, current, view, 5);
    expect(sphericalOf(pose).distance).toBeCloseTo(5, 9);
  });

  it("falls back to the overview angle without a current pose", () => {
    const s = sphericalOf(framePose({ center: [0, 0, 0], radius: 10 }, null, view));
    expect(s.polar).toBeCloseTo(OVERVIEW_POLAR, 9);
  });

  it("fits with the given padding", () => {
    const sphere: FrameSphere = { center: [0, 0, 0], radius: 10 };
    const tight = sphericalOf(framePose(sphere, current, view, 0, 1.1)).distance;
    expect(tight).toBeCloseTo(fitDistance(10, view, 1.1), 9);
    expect(tight).toBeLessThan(sphericalOf(framePose(sphere, current, view)).distance);
  });
});

describe("enclosingSphere", () => {
  const encloses = (outer: FrameSphere, inner: FrameSphere) => {
    const [x, y, z] = inner.center;
    const offset = Math.hypot(x - outer.center[0], y - outer.center[1], z - outer.center[2]);
    return offset + inner.radius <= outer.radius + 1e-9;
  };

  it("returns a single sphere unchanged and null for none", () => {
    expect(enclosingSphere([{ center: [1, 2, 3], radius: 4 }])).toEqual({
      center: [1, 2, 3],
      radius: 4,
    });
    expect(enclosingSphere([])).toBeNull();
  });

  it("is exact for two spheres of equal radius", () => {
    expect(
      enclosingSphere([
        { center: [0, 0, 0], radius: 1 },
        { center: [10, 0, 0], radius: 1 },
      ]),
    ).toEqual({ center: [5, 0, 0], radius: 6 });
  });

  it("encloses every sphere, whatever their order", () => {
    const spheres: FrameSphere[] = [
      { center: [0, 2, 0], radius: 3 },
      { center: [40, 1, -12], radius: 1.5 },
      { center: [-8, 20, 30], radius: 6 },
      { center: [5, 0, 5], radius: 0.5 },
      { center: [3, 1, 2], radius: 40 },
    ];
    const merged = enclosingSphere(spheres);
    expect(merged).not.toBeNull();
    if (!merged) return;
    for (const sphere of spheres) expect(encloses(merged, sphere)).toBe(true);
    expect(enclosingSphere([...spheres].reverse())).toEqual(merged);
    // A sphere containing the others is (nearly) the answer: no needless growth.
    expect(merged.radius).toBeLessThan(40 * 1.35);
  });

  it("ignores non-finite spheres and treats negative radii as points", () => {
    expect(
      enclosingSphere([
        { center: [Number.NaN, 0, 0], radius: 1 },
        { center: [0, 0, 0], radius: Number.POSITIVE_INFINITY },
        { center: [2, 0, 0], radius: -5 },
        { center: [4, 0, 0], radius: 0 },
      ]),
    ).toEqual({ center: [3, 0, 0], radius: 1 });
    expect(enclosingSphere([{ center: [0, Number.NaN, 0], radius: 1 }])).toBeNull();
  });
});

describe("focusPointPose", () => {
  it("moves the target to the ground point and keeps the viewing offset", () => {
    const current: CameraPose = { position: [10, 40, 30], target: [0, 0, 0] };
    const pose = focusPointPose(current, 100, -50);
    expect(pose.target).toEqual([100, 0, -50]);
    expect(pose.position).toEqual([110, 40, -20]);
  });
});

describe("lookTarget", () => {
  it("hits the ground when looking down", () => {
    expect(lookTarget([0, 10, 0], [0, -1, -1], 1000, 50)).toEqual([0, 0, -10]);
  });

  it("falls back to a point ahead when looking at the horizon", () => {
    const target = lookTarget([0, 10, 0], [0, 0, -1], 1000, 50);
    expect(target).toEqual([0, 10, -50]);
  });

  it("falls back when the ground hit is too far away", () => {
    const target = lookTarget([0, 10, 0], [0, -0.001, -1], 100, 50);
    expect(target[1]).toBeGreaterThan(9);
  });
});

describe("legalOrbitTarget", () => {
  const options = { maxDistance: 1_000, fallbackDistance: 50, minDistance: 2, worldSize: 400 };
  const position: Vec3 = [5, 20, 5];

  it("keeps the ground point the camera looks down at", () => {
    const direction: Vec3 = [0, -1, -1];
    const target = legalOrbitTarget(position, direction, options);
    expect(target).toEqual(lookTarget(position, direction, 1_000, 50));
    expect(target[1]).toBe(0);
  });

  it.each([
    ["level", [1, 0, 0] as Vec3],
    ["up", [1, 0.386, 0] as Vec3],
    ["almost straight up", [0.05, 1, 0] as Vec3],
  ])("targets the ground ahead, 15° below the horizon, when looking %s", (_, direction) => {
    const target = legalOrbitTarget(position, direction, options);
    expect(target[1]).toBe(0);
    // Ahead along the heading (+X here), same Z.
    expect(target[0]).toBeGreaterThan(position[0]);
    expect(target[2]).toBeCloseTo(position[2], 9);
    expect(orbitPolar(position, target)).toBeCloseTo(ORBIT_FALLBACK_POLAR, 9);
    expect(orbitPolar(position, target)).toBeLessThan(MAX_POLAR);
  });

  it("replaces a ground hit that lies beyond the polar limit", () => {
    // Barely looking down: the ground hit is ~1,000 units out, almost horizontal.
    const direction: Vec3 = [1, -0.02, 0];
    const target = legalOrbitTarget(position, direction, { ...options, maxDistance: 5_000 });
    expect(orbitPolar(position, target)).toBeLessThan(MAX_POLAR);
  });

  it("stays within the world and outside the minimum orbit distance", () => {
    const high: Vec3 = [0, 300, 0];
    const far = legalOrbitTarget(high, [0, 0.2, 1], options);
    expect(Math.hypot(far[0], far[2])).toBeCloseTo(400, 9);
    const low: Vec3 = [0, MIN_CAMERA_Y, 0];
    const near = legalOrbitTarget(low, [0, 0, 1], { ...options, minDistance: 6 });
    expect(Math.hypot(near[0], near[2])).toBeCloseTo(6, 9);
    expect(orbitPolar(low, near)).toBeLessThan(MAX_POLAR);
  });

  it("falls back to the point below when there is no heading", () => {
    expect(legalOrbitTarget(position, [0, 1, 0], options)).toEqual([5, 0, 5]);
  });
});

describe("sanitizePose", () => {
  it("rejects malformed or degenerate poses", () => {
    expect(sanitizePose(null)).toBeNull();
    expect(sanitizePose({ position: [0, Number.NaN, 0], target: [0, 0, 0] })).toBeNull();
    expect(sanitizePose({ position: [1, 1, 1], target: [1, 1, 1] })).toBeNull();
    expect(
      sanitizePose({ position: [0, 0], target: [0, 0, 0] } as unknown as CameraPose),
    ).toBeNull();
  });

  it("lifts the camera above the ground", () => {
    expect(sanitizePose({ position: [0, -20, 5], target: [0, 0, 0] })?.position[1]).toBe(
      MIN_CAMERA_Y,
    );
  });
});

describe("roundPose / posesEqual", () => {
  it("rounds for compact reporting and compares with a tolerance", () => {
    const pose: CameraPose = { position: [1.23456, -0.0001, 3], target: [0, 0, 0] };
    expect(roundPose(pose)).toEqual({ position: [1.23, 0, 3], target: [0, 0, 0] });
    expect(posesEqual(pose, { position: [1.2346, 0, 3], target: [0, 0, 0] }, 1e-3)).toBe(true);
    expect(posesEqual(pose, { position: [1.3, 0, 3], target: [0, 0, 0] }, 1e-3)).toBe(false);
    expect(posesEqual(null, null)).toBe(true);
    expect(posesEqual(pose, null)).toBe(false);
  });
});

describe("world-scaled limits", () => {
  it("scales distance limits and clipping planes with the world", () => {
    const small = distanceLimits(50);
    const large = distanceLimits(5_000);
    expect(small.min).toBeLessThan(small.max);
    expect(large.max).toBeGreaterThan(small.max);
    const planes = clippingPlanes(2_000);
    expect(planes.near).toBeGreaterThan(0);
    expect(planes.far / planes.near).toBeLessThan(1e6);
    expect(planes.far).toBeGreaterThan(distanceLimits(2_000).max);
  });
});
