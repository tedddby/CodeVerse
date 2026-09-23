import {
  BOOST_MULTIPLIER,
  MAX_PITCH,
  MOVEMENT_KEY_CODES,
  constrainPosition,
  dampVelocity,
  desiredVelocity,
  flightSpeed,
  forwardVector,
  isIdle,
  movementFromKeys,
  wheelImpulse,
  wheelPixels,
  yawPitchFromDirection,
} from "./flight";
import { MIN_CAMERA_Y } from "./poses";

describe("movementFromKeys", () => {
  it("maps WASD/QE and arrow aliases", () => {
    expect(movementFromKeys(new Set(["KeyW"]))).toEqual({
      forward: 1,
      right: 0,
      up: 0,
      boost: false,
    });
    expect(movementFromKeys(new Set(["ArrowDown", "ArrowLeft"]))).toEqual({
      forward: -1,
      right: -1,
      up: 0,
      boost: false,
    });
    expect(movementFromKeys(new Set(["KeyE", "ShiftRight"]))).toEqual({
      forward: 0,
      right: 0,
      up: 1,
      boost: true,
    });
    expect(movementFromKeys(new Set(["KeyQ"])).up).toBe(-1);
  });

  it("cancels opposing keys", () => {
    const input = movementFromKeys(new Set(["KeyW", "KeyS", "KeyA", "KeyD"]));
    expect(isIdle(input)).toBe(true);
  });

  it("covers exactly the continuous movement keys", () => {
    expect(MOVEMENT_KEY_CODES.has("KeyR")).toBe(false);
    expect(MOVEMENT_KEY_CODES.has("Tab")).toBe(false);
    expect(MOVEMENT_KEY_CODES.has("ShiftLeft")).toBe(true);
  });
});

describe("flightSpeed", () => {
  it("scales with world size and altitude, and boosts ×3", () => {
    expect(flightSpeed(2_000, 10, false)).toBeGreaterThan(flightSpeed(100, 10, false));
    expect(flightSpeed(500, 200, false)).toBeGreaterThan(flightSpeed(500, 5, false));
    expect(flightSpeed(500, 20, true)).toBeCloseTo(
      flightSpeed(500, 20, false) * BOOST_MULTIPLIER,
      9,
    );
  });

  it("is positive even for degenerate worlds", () => {
    expect(flightSpeed(0, -10, false)).toBeGreaterThan(0);
  });
});

describe("look angles", () => {
  it("round-trips yaw and pitch through a direction vector", () => {
    for (const [yaw, pitch] of [
      [0, 0],
      [1.2, -0.4],
      [-2.5, 0.9],
    ] as const) {
      const angles = yawPitchFromDirection(forwardVector(yaw, pitch));
      expect(angles.yaw).toBeCloseTo(yaw, 9);
      expect(angles.pitch).toBeCloseTo(pitch, 9);
    }
  });

  it("looks toward -Z at yaw 0 and clamps near-vertical pitch", () => {
    const [x, y, z] = forwardVector(0, 0);
    expect(x).toBeCloseTo(0, 12);
    expect(y).toBeCloseTo(0, 12);
    expect(z).toBeCloseTo(-1, 12);
    expect(yawPitchFromDirection([0, -1, 0]).pitch).toBeCloseTo(-MAX_PITCH, 9);
  });
});

describe("desiredVelocity", () => {
  it("moves horizontally along the heading regardless of pitch", () => {
    const [x, y, z] = desiredVelocity({ forward: 1, right: 0, up: 0, boost: false }, 0, 10);
    expect([x, y, z].map((n) => Math.round(n * 1e9) / 1e9)).toEqual([0, 0, -10]);
  });

  it("strafes to the camera's right", () => {
    const [x, , z] = desiredVelocity(
      { forward: 0, right: 1, up: 0, boost: false },
      Math.PI / 2,
      10,
    );
    // Heading -X (yaw 90°): right is -Z.
    expect(x).toBeCloseTo(0, 9);
    expect(z).toBeCloseTo(-10, 9);
  });

  it("normalizes diagonals", () => {
    const v = desiredVelocity({ forward: 1, right: 1, up: 1, boost: false }, 0.3, 10);
    expect(Math.hypot(...v)).toBeCloseTo(10, 9);
  });
});

describe("dampVelocity", () => {
  it("approaches the target and is frame-rate independent", () => {
    const oneStep = dampVelocity([0, 0, 0], [10, 0, 0], 0.1);
    let twoSteps: [number, number, number] = [0, 0, 0];
    twoSteps = dampVelocity(twoSteps, [10, 0, 0], 0.05);
    twoSteps = dampVelocity(twoSteps, [10, 0, 0], 0.05);
    expect(oneStep[0]).toBeGreaterThan(0);
    expect(oneStep[0]).toBeLessThan(10);
    expect(twoSteps[0]).toBeCloseTo(oneStep[0], 9);
  });
});

describe("wheel", () => {
  it("normalizes delta modes and clamps huge deltas", () => {
    expect(wheelPixels(3, 1)).toBe(48);
    expect(wheelPixels(1, 2)).toBe(400);
    expect(wheelPixels(10_000, 0)).toBe(400);
    expect(wheelPixels(Number.NaN, 0)).toBe(0);
  });

  it("scrolling up (negative delta) moves forward", () => {
    expect(wheelImpulse(-100, 10)).toBeGreaterThan(0);
    expect(wheelImpulse(100, 10)).toBeLessThan(0);
  });
});

describe("constrainPosition", () => {
  it("keeps the camera above the ground and within the roaming radius", () => {
    expect(constrainPosition([0, -5, 0], [0, 0, 0], 100)[1]).toBe(MIN_CAMERA_Y);
    const [x, , z] = constrainPosition([300, 10, 400], [0, 0, 0], 100);
    expect(Math.hypot(x, z)).toBeCloseTo(100, 9);
    expect(constrainPosition([0, 5_000, 0], [0, 0, 0], 100)[1]).toBe(100);
  });
});
