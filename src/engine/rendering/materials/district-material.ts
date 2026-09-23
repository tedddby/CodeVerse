import { Color, ShaderMaterial } from "three";
import { hexToLinear, SCENE_HEX } from "../palette";
import {
  INSTANCE_SCALE_GLSL,
  LIGHTING_PARS_GLSL,
  OUTPUT_GLSL,
  fogUniforms,
  lightingUniforms,
} from "./shader-chunks";

/**
 * District slab material (instanced boxes, base at y = 0 in local space).
 *
 * Per-instance attributes:
 * - aColor (vec3) linear slab color (deeper levels slightly lighter);
 * - aState (vec2) x emphasis 0..1 (focus), y state bits (1 hovered, 2 selected, 4 focused).
 *
 * Slabs stay matte and quiet; the top gets a soft inner bevel so nested
 * terraces read as stacked plates, and a faint tint when hovered or selected.
 * The crisp outline itself is a separate LineSegments layer.
 */

export const DISTRICT_STATE = { hovered: 1, selected: 2, focused: 4 } as const;

const vertexShader = /* glsl */ `
attribute vec3 aColor;
attribute vec2 aState;

varying vec3 vColor;
varying vec2 vState;
varying vec3 vNormal;
varying vec2 vUv;
varying vec2 vFaceSize;

#include <fog_pars_vertex>
${INSTANCE_SCALE_GLSL}

void main() {
  vec3 scale = cvInstanceScale();
  vec4 worldPosition = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vec4 mvPosition = viewMatrix * worldPosition;
  gl_Position = projectionMatrix * mvPosition;
  vFaceSize = cvFaceSize(normal, scale);
  vNormal = normal;
  vUv = uv;
  vColor = aColor;
  vState = aState;
  #include <fog_vertex>
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 uSignal;
uniform vec3 uFlare;
uniform float uBevel;

varying vec3 vColor;
varying vec2 vState;
varying vec3 vNormal;
varying vec2 vUv;
varying vec2 vFaceSize;

#include <fog_pars_fragment>
${LIGHTING_PARS_GLSL}

void main() {
  float emphasis = clamp(vState.x, 0.0, 1.0);
  float state = floor(vState.y + 0.5);
  float hovered = mod(state, 2.0);
  float selected = mod(floor(state / 2.0), 2.0);
  float focused = mod(floor(state / 4.0), 2.0);

  vec3 normal = normalize(vNormal);
  float isTop = step(0.5, normal.y);

  vec3 albedo = vColor * mix(0.4, 1.0, emphasis);
  vec3 color = albedo * cvLighting(normal);

  // Soft inner bevel along the top rim: plates read as raised terraces.
  vec2 toEdge = min(vUv, 1.0 - vUv) * vFaceSize;
  float rim = 1.0 - smoothstep(0.0, uBevel, min(toEdge.x, toEdge.y));
  color *= 1.0 + 0.18 * rim * isTop;
  // Side faces a touch darker so slab thickness reads at grazing angles.
  color *= mix(0.8, 1.0, isTop);

  color += uSignal * (0.035 * hovered + 0.02 * focused) * isTop;
  color += uFlare * 0.045 * selected * isTop;

  gl_FragColor = vec4(color, 1.0);
  ${OUTPUT_GLSL}
}
`;

export function createDistrictMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    name: "CodeVerseDistrict",
    vertexShader,
    fragmentShader,
    fog: true,
    uniforms: {
      ...fogUniforms(),
      ...lightingUniforms(),
      uSignal: { value: new Color(...hexToLinear(SCENE_HEX.signal)) },
      uFlare: { value: new Color(...hexToLinear(SCENE_HEX.flare)) },
      uBevel: { value: 0.6 },
    },
  });
}
