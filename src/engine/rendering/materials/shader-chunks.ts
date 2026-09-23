import {
  Color,
  UniformsLib,
  UniformsUtils,
  Vector3,
  type IUniform,
  type ShaderMaterial,
} from "three";

/**
 * Shared GLSL and uniforms for the scene's custom materials.
 *
 * Lighting is analytic and identical for every custom material: a cool
 * hemisphere (sky above, near-black ground below) plus one warm directional
 * key light. No shadow maps — grounding is faked per material (darker bases).
 * All colors are linear; three.js applies tone mapping, output color space
 * and fog through the standard includes at the end of each fragment shader.
 */

export const LIGHTING = {
  sky: [0.42, 0.47, 0.58] as const,
  ground: [0.07, 0.08, 0.11] as const,
  key: [0.8, 0.77, 0.72] as const,
  keyDirection: new Vector3(0.45, 0.8, 0.35).normalize(),
};

/** Uniform declarations for `cvLighting()`. */
export const LIGHTING_PARS_GLSL = /* glsl */ `
uniform vec3 uSky;
uniform vec3 uGroundLight;
uniform vec3 uKey;
uniform vec3 uKeyDirection;

vec3 cvLighting(vec3 normal) {
  float hemisphere = normal.y * 0.5 + 0.5;
  return mix(uGroundLight, uSky, hemisphere) + uKey * max(dot(normal, uKeyDirection), 0.0);
}
`;

/**
 * Anti-aliased line helpers driven by screen-space derivatives, so lines stay
 * about one pixel wide at every distance and fade out when they would alias.
 */
export const LINE_PARS_GLSL = /* glsl */ `
// 1 on integer values of 'coordinate', ~'widthPx' pixels wide.
float cvGridLine(float coordinate, float widthPx) {
  float fw = max(fwidth(coordinate), 1e-5);
  float distanceToLine = abs(fract(coordinate - 0.5) - 0.5);
  float line = 1.0 - smoothstep(fw * max(widthPx - 0.5, 0.0), fw * (widthPx + 0.5), distanceToLine);
  // Lines closer together than a few pixels would shimmer: fade them out.
  return line * (1.0 - smoothstep(0.18, 0.4, fw));
}

// 1 where 'distanceToEdge' (world units) is within ~'widthPx' pixels.
float cvEdgeLine(float distanceToEdge, float widthPx) {
  float fw = max(fwidth(distanceToEdge), 1e-5);
  return 1.0 - smoothstep(fw * max(widthPx - 0.5, 0.0), fw * (widthPx + 0.5), distanceToEdge);
}
`;

/** Per-instance scale from the instance matrix (instances are never rotated). */
export const INSTANCE_SCALE_GLSL = /* glsl */ `
vec3 cvInstanceScale() {
  return vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
}

// World size of the face a vertex belongs to, along its (u, v) directions,
// for three.js BoxGeometry: +-X faces span (z, y), +-Z faces (x, y), +-Y faces (x, z).
vec2 cvFaceSize(vec3 faceNormal, vec3 scale) {
  vec3 axis = abs(faceNormal);
  if (axis.x > 0.5) return vec2(scale.z, scale.y);
  if (axis.z > 0.5) return vec2(scale.x, scale.y);
  return vec2(scale.x, scale.z);
}
`;

/** Tone mapping, output color space and fog, in three.js' own order. */
export const OUTPUT_GLSL = /* glsl */ `
#include <tonemapping_fragment>
#include <colorspace_fragment>
#include <fog_fragment>
`;

export function lightingUniforms(): Record<string, IUniform> {
  return {
    uSky: { value: new Color(...LIGHTING.sky) },
    uGroundLight: { value: new Color(...LIGHTING.ground) },
    uKey: { value: new Color(...LIGHTING.key) },
    uKeyDirection: { value: LIGHTING.keyDirection.clone() },
  };
}

/** Fog uniforms three.js refreshes automatically for materials with `fog: true`. */
export function fogUniforms(): Record<string, IUniform> {
  return UniformsUtils.clone(UniformsLib.fog);
}

/**
 * Sets a uniform's value if the material declares it. Kept outside React
 * components so render-loop updates stay plain imperative three.js code.
 */
export function setUniform(material: ShaderMaterial, name: string, value: unknown): void {
  const uniform = material.uniforms[name];
  if (uniform) uniform.value = value;
}
