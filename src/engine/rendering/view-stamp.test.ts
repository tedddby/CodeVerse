import { PerspectiveCamera } from "three";
import { ViewStamp } from "./view-stamp";

const SIZE = { width: 1440, height: 900 };

function camera(): PerspectiveCamera {
  const created = new PerspectiveCamera(45, SIZE.width / SIZE.height, 0.1, 5_000);
  created.position.set(120, 100, 120);
  created.lookAt(0, 0, 0);
  return created;
}

describe("ViewStamp", () => {
  it("reports the first view, then nothing while the view is idle", () => {
    const stamp = new ViewStamp();
    const cam = camera();
    expect(stamp.update(cam, SIZE)).toBe(true);
    expect(stamp.update(cam, SIZE)).toBe(false);
    expect(stamp.update(cam, { ...SIZE })).toBe(false);
  });

  it("reports camera moves, turns, projection and viewport changes once each", () => {
    const stamp = new ViewStamp();
    const cam = camera();
    stamp.update(cam, SIZE);

    cam.position.x += 0.01;
    expect(stamp.update(cam, SIZE)).toBe(true);
    expect(stamp.update(cam, SIZE)).toBe(false);

    cam.lookAt(10, 0, 0);
    expect(stamp.update(cam, SIZE)).toBe(true);

    cam.fov = 50;
    cam.updateProjectionMatrix();
    expect(stamp.update(cam, SIZE)).toBe(true);

    expect(stamp.update(cam, { width: 1354, height: 846 })).toBe(true);
    expect(stamp.update(cam, { width: 1354, height: 846 })).toBe(false);
  });

  it("reports a change after being invalidated", () => {
    const stamp = new ViewStamp();
    const cam = camera();
    stamp.update(cam, SIZE);
    stamp.invalidate();
    expect(stamp.update(cam, SIZE)).toBe(true);
  });
});
