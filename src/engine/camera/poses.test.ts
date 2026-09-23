import type { CameraPose } from "@/state/explorer-store";
import {
  FRAME_MAX_POLAR,
  FRAME_MIN_POLAR,
  MIN_CAMERA_Y,
  OVERVIEW_AZIMUTH,
  OVERVIEW_POLAR,
  clippingPlanes,
  distanceLimits,
  establishingPose,
  fitDistance,
  focusPointPose,
  framePose,
  lookTarget,
  overviewPose,
  overviewTarget,
  poseFromSpherical,
  posesEqual,
  roundPose,
  sanitizePose,
  sphericalOf,
  type FrameSphere,
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
