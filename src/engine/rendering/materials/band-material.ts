import { Color, ShaderMaterial } from "three";
import { hexToLinear, SCENE_HEX } from "../palette";
import {
  INSTANCE_SCALE_GLSL,
  LIGHTING_PARS_GLSL,
  LINE_PARS_GLSL,
  OUTPUT_GLSL,
  fogUniforms,
  lightingUniforms,
} from "./shader-chunks";

/**
 * Symbol band material: thin translucent collars around a building
 * (instanced boxes, base at y = 0 in local space).
 *
 * Per-instance attributes:
 * - aColor (vec3) linear symbol-kind color;
 * - aState (vec2) x emphasis 0..1, y state bits (1 hovered, 2 selected).
 *
 * The facade stays visible through a faint tint; what reads are the crisp
 * rings at each band's top and bottom (the floors of the symbol) and its
 * corners. Hover lifts the tint, selection outlines the band in flare amber.
 * Not tone-mapped, so symbol-kind colors match the legend.
 */

export const BAND_STATE = { hovered: 1, selected: 2 } as const;

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
uniform vec3 uFlare;

varying vec3 vColor;
varying vec2 vState;
varying vec3 vNormal;
varying vec2 vUv;
varying vec2 vFaceSize;

#include <fog_pars_fragment>
${LIGHTING_PARS_GLSL}
${LINE_PARS_GLSL}

void main() {
  float emphasis = clamp(vState.x, 0.0, 1.0);
  float state = floor(vState.y + 0.5);
  float hovered = mod(state, 2.0);
  float selected = step(1.5, state);

  vec3 normal = normalize(vNormal);
  float isSide = 1.0 - step(0.5, abs(normal.y));
  vec2 toEdge = min(vUv, 1.0 - vUv) * vFaceSize;
  // Side faces: horizontal rings (band top/bottom) plus softer vertical corners.
  float rings = cvEdgeLine(toEdge.y, 1.0) * isSide;
  float corners = cvEdgeLine(toEdge.x, 1.0) * isSide * 0.45;
  // Top/bottom faces only show as a thin rim around the facade: draw them as ring.
  float rim = 1.0 - isSide;
  float line = max(max(rings, corners), rim);

  vec3 shade = vColor * (0.55 + 0.45 * cvLighting(normal));
  float fillAlpha = mix(0.06, 0.2, emphasis) + 0.14 * hovered;
  float lineAlpha = mix(0.35, 0.9, emphasis) + 0.1 * hovered;
  vec3 color = mix(shade, vColor * 1.25, line);
  float alpha = mix(fillAlpha, lineAlpha, line);

  // Selection: flare outline and a light warm tint (the facade stays readable).
  color = mix(color, uFlare * 1.2, selected * max(line, 0.2));
  alpha = mix(alpha, max(alpha, mix(0.16, 1.0, line)), selected);

  gl_FragColor = vec4(color, clamp(alpha, 0.0, 1.0));
  ${OUTPUT_GLSL}
}
`;

export function createBandMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    name: "CodeVerseSymbolBand",
    vertexShader,
    fragmentShader,
    fog: true,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    uniforms: {
      ...fogUniforms(),
      ...lightingUniforms(),
      uFlare: { value: new Color(...hexToLinear(SCENE_HEX.flare)) },
    },
  });
}
