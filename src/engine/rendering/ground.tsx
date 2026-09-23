"use client";

import { Grid } from "@react-three/drei";
import { useEffect, useMemo } from "react";
import { Vector2 } from "three";
import { niceStep } from "./environment-math";
import { createGroundMaterial } from "./materials/effect-materials";
import { setUniform } from "./materials/shader-chunks";
import { RENDER_HEX, SCENE_HEX, hexToLinear, scaleRgb } from "./palette";

/**
 * The ground: a large dark plane with a faint pool of light under the city,
 * and a fading engineering grid scaled to the world (cells ≈ world / 60,
 * rounded to 1-2-5 steps; sections every 5 cells).
 */

export interface GroundProps {
  centerX: number;
  centerZ: number;
  worldSize: number;
}

export function Ground({ centerX, centerZ, worldSize }: GroundProps) {
  const size = Math.max(1, worldSize);
  const material = useMemo(
    () =>
      createGroundMaterial(
        hexToLinear(RENDER_HEX.ground),
        scaleRgb(hexToLinear(SCENE_HEX.signalDim), 0.07),
      ),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => {
    setUniform(material, "uCenter", new Vector2(centerX, centerZ));
    setUniform(material, "uRadius", size * 0.75);
  }, [material, centerX, centerZ, size]);

  const cell = niceStep(size / 60);
  const planeSize = size * 30 + 2_000;

  return (
    <group name="ground">
      <mesh
        rotation-x={-Math.PI / 2}
        position={[centerX, -Math.max(0.02, size * 0.0005), centerZ]}
        material={material}
        renderOrder={-1}
      >
        <planeGeometry args={[planeSize, planeSize]} />
      </mesh>
      <Grid
        position={[centerX, 0, centerZ]}
        infiniteGrid
        cellSize={cell}
        sectionSize={cell * 5}
        cellThickness={0.6}
        sectionThickness={1}
        cellColor={RENDER_HEX.gridCell}
        sectionColor={RENDER_HEX.gridSection}
        fadeDistance={size * 2.4}
        fadeStrength={1.4}
        followCamera={false}
      />
    </group>
  );
}
