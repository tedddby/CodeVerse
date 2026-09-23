import { Color, ShaderMaterial } from "three";
import { hexToLinear, SCENE_HEX } from "../palette";
import { INTRO_DONE, INTRO_RISE_DURATION } from "../intro";
import {
  INSTANCE_SCALE_GLSL,
  LIGHTING_PARS_GLSL,
  LINE_PARS_GLSL,
  OUTPUT_GLSL,
  fogUniforms,
  lightingUniforms,
} from "./shader-chunks";

/**
 * Building material (instanced boxes whose base sits at y = 0 in local space).
 *
 * Per-instance attributes:
 * - aColor  (vec3)  linear base color from the visual encoding;
 * - aParams (vec4)  x emphasis 0..1, y glow 0..1, z state bits (1 hovered,
 *                   2 selected), w honesty flags (1 estimated, 2 binary, 4 generated);
 * - aDelay  (float) intro start delay in seconds.
 *
 * Look: matte hemisphere + key lighting, facades darken toward the ground,
 * faint floor seams that fade with distance, ~1px rim lines on roof and
 * corners, emissive glow only where the encoding asks for it, and a flare
 * outline for the selection. Estimated (metadata-only) buildings are drawn
 * hollow and hatched so they never pass for analysed data.
 */

export const BUILDING_STATE = { hovered: 1, selected: 2 } as const;

const vertexShader = /* glsl */ `
attribute vec3 aColor;
attribute vec4 aParams;
attribute float aDelay;

uniform float uIntro;
uniform float uRiseDuration;

varying vec3 vColor;
varying vec4 vParams;
varying vec3 vNormal;
varying vec2 vUv;
varying vec2 vFaceSize;
varying float vHeight;
varying float vHeightAbove;
varying float vViewDistance;
varying vec3 vWorldPosition;

#include <fog_pars_vertex>
${INSTANCE_SCALE_GLSL}

void main() {
  float progress = clamp((uIntro - aDelay) / uRiseDuration, 0.0, 1.0);
  float rise = max(1.0 - pow(1.0 - progress, 3.0), 0.0005);
  vec3 scale = cvInstanceScale();
  vec3 transformed = vec3(position.x, position.y * rise, position.z);

  vec4 worldPosition = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
  vec4 mvPosition = viewMatrix * worldPosition;
  gl_Position = projectionMatrix * mvPosition;

  float height = scale.y * rise;
  vFaceSize = cvFaceSize(normal, vec3(scale.x, height, scale.z));
  vHeight = height;
  vHeightAbove = position.y * height;
  vNormal = normal;
  vUv = uv;
  vColor = aColor;
  vParams = aParams;
  vViewDistance = -mvPosition.z;
  vWorldPosition = worldPosition.xyz;
  #include <fog_vertex>
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 uFlare;
uniform float uFloorSpacing;
uniform float uDetailNear;
uniform float uDetailFar;

varying vec3 vColor;
varying vec4 vParams;
varying vec3 vNormal;
varying vec2 vUv;
varying vec2 vFaceSize;
varying float vHeight;
varying float vHeightAbove;
varying float vViewDistance;
varying vec3 vWorldPosition;

#include <fog_pars_fragment>
${LIGHTING_PARS_GLSL}
${LINE_PARS_GLSL}

void main() {
  float emphasis = clamp(vParams.x, 0.0, 1.0);
  float glow = clamp(vParams.y, 0.0, 1.0);
  float state = floor(vParams.z + 0.5);
  float hovered = mod(state, 2.0);
  float selected = step(1.5, state);
  float flags = floor(vParams.w + 0.5);
  float estimated = mod(flags, 2.0);
  float binary = mod(floor(flags / 2.0), 2.0);

  vec3 normal = normalize(vNormal);
  float isTop = step(0.5, normal.y);
  float isSide = 1.0 - step(0.5, abs(normal.y));

  // Emphasis: dimmed buildings desaturate and darken.
  vec3 albedo = vColor;
  float luma = dot(albedo, vec3(0.2126, 0.7152, 0.0722));
  albedo = mix(vec3(luma) * 0.6, albedo, emphasis) * mix(0.3, 1.0, emphasis);
  // Honesty: content never analysed -> a darker, hollow body.
  albedo *= mix(1.0, 0.45, estimated);

  vec3 color = albedo * cvLighting(normal);

  // Facade gradient and contact darkening (fake grounding without shadow maps).
  float heightFraction = vHeight > 0.0 ? clamp(vHeightAbove / vHeight, 0.0, 1.0) : 0.0;
  float gradient = mix(0.55, 1.0, smoothstep(0.0, 1.0, pow(heightFraction, 0.75)));
  float contact = mix(0.6, 1.0, smoothstep(0.0, min(1.5, vHeight * 0.6) + 0.001, vHeightAbove));
  color *= mix(1.0, gradient * contact, isSide);
  color *= mix(1.0, 1.08, isTop);

  float detail = 1.0 - smoothstep(uDetailNear, uDetailFar, vViewDistance);

  // Floor seams on facades (not on binaries), skipping the ground line.
  float floorCoordinate = vHeightAbove / max(uFloorSpacing, 1e-3);
  float floors = cvGridLine(floorCoordinate, 0.75) * step(0.5, floorCoordinate);
  color *= 1.0 - 0.2 * floors * isSide * (1.0 - binary) * detail;

  // Rim lines: roof outline plus vertical corners and the facade's top edge.
  vec2 toEdge = min(vUv, 1.0 - vUv) * vFaceSize;
  float sideEdge = min(toEdge.x, (1.0 - vUv.y) * vFaceSize.y);
  float roofEdge = min(toEdge.x, toEdge.y);
  float edge = cvEdgeLine(mix(sideEdge, roofEdge, isTop), 1.0);
  float edgeStrength = mix(0.22, 0.5, isTop) * mix(0.6, 1.0, detail);
  edgeStrength = mix(edgeStrength, 1.1, estimated);
  color += albedo * edge * edgeStrength;

  // Estimated content: diagonal hatching across every face.
  float hatchCoordinate = (vWorldPosition.x + vWorldPosition.y + vWorldPosition.z) / max(uFloorSpacing * 1.6, 0.05);
  color += albedo * cvGridLine(hatchCoordinate, 0.6) * 0.55 * estimated;

  // Hover: a subtle lift of body and edges.
  color += albedo * (0.14 + edge * 0.45) * hovered;

  // Glow: emissive boost reserved for meaning (relations, hot spots, selection).
  color += albedo * glow * 0.6;

  // Selection: flare outline and a faint warm wash.
  color = mix(color, uFlare * 1.5, edge * selected * 0.95);
  color += uFlare * 0.05 * selected;

  gl_FragColor = vec4(color, 1.0);
  ${OUTPUT_GLSL}
}
`;

export interface BuildingMaterialUniformValues {
  floorSpacing: number;
  detailNear: number;
  detailFar: number;
}

export function createBuildingMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    name: "CodeVerseBuilding",
    vertexShader,
    fragmentShader,
    fog: true,
    uniforms: {
      ...fogUniforms(),
      ...lightingUniforms(),
      uIntro: { value: INTRO_DONE },
      uRiseDuration: { value: INTRO_RISE_DURATION },
      uFlare: { value: new Color(...hexToLinear(SCENE_HEX.flare)) },
      uFloorSpacing: { value: 1 },
      uDetailNear: { value: 40 },
      uDetailFar: { value: 160 },
    },
  });
}

export function setBuildingMaterialScale(
  material: ShaderMaterial,
  values: BuildingMaterialUniformValues,
): void {
  const uniforms = material.uniforms;
  if (uniforms.uFloorSpacing) uniforms.uFloorSpacing.value = values.floorSpacing;
  if (uniforms.uDetailNear) uniforms.uDetailNear.value = values.detailNear;
  if (uniforms.uDetailFar) uniforms.uDetailFar.value = values.detailFar;
}

/** World-relative detail parameters for a layout. */
export function buildingScaleFor(
  worldSize: number,
  maxHeight: number,
): BuildingMaterialUniformValues {
  const size = Math.max(1, worldSize);
  const detailNear = Math.min(120, Math.max(20, size * 0.12));
  return {
    floorSpacing: Math.max(0.35, maxHeight / 30),
    detailNear,
    detailFar: detailNear * 3.5,
  };
}
