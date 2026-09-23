"use client";

import { useEffect, useMemo } from "react";
import { BufferAttribute, BufferGeometry } from "three";
import { dustPositions, fogDensity } from "./environment-math";
import { SCENE_HEX } from "./palette";

/**
 * Background, distance fog and a sparse, static field of faint dust points
 * far beyond the city. Fog density scales with the world so a small
 * repository and a huge monorepo get the same sense of depth.
 */

export interface AtmosphereProps {
  worldSize: number;
}

const DUST_COUNT = 700;

export function Atmosphere({ worldSize }: AtmosphereProps) {
  const size = Math.max(1, worldSize);
  const geometry = useMemo(() => {
    const created = new BufferGeometry();
    created.setAttribute("position", new BufferAttribute(dustPositions(DUST_COUNT, size * 5), 3));
    created.computeBoundingSphere();
    return created;
  }, [size]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <>
      <color attach="background" args={[SCENE_HEX.void]} />
      <fogExp2 attach="fog" args={[SCENE_HEX.void, fogDensity(size)]} />
      <points geometry={geometry} frustumCulled={false}>
        <pointsMaterial
          color={SCENE_HEX.inkSubtle}
          size={1.5}
          sizeAttenuation={false}
          transparent
          opacity={0.45}
          depthWrite={false}
          fog={false}
          toneMapped={false}
        />
      </points>
    </>
  );
}
