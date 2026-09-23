import { AdditiveBlending, Color, ShaderMaterial, Vector2 } from "three";
import { hexToLinear, type Rgb } from "../palette";
import { OUTPUT_GLSL, fogUniforms } from "./shader-chunks";

/**
 * Materials for non-instanced effects: dependency arcs, the ground and the
 * selection beam.
 */

// ─── Dependency arcs ────────────────────────────────────────────────────────

const edgeVertexShader = /* glsl */ `
attribute vec3 aColor;
// x: progress along the arc 0..1, y: arc length (world units), z: intensity 0..1
attribute vec3 aArc;

varying vec3 vColor;
varying vec3 vArc;

#include <fog_pars_vertex>

void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  vColor = aColor;
  vArc = aArc;
  #include <fog_vertex>
}
`;

const edgeFragmentShader = /* glsl */ `
uniform float uTime;
uniform float uDashSpacing;
uniform float uFlowSpeed;
uniform float uDensity;

varying vec3 vColor;
varying vec3 vArc;

#include <fog_pars_fragment>

void main() {
  float along = vArc.x * vArc.y;
  // Dashes travel from source to target (increasing 'along') as time advances.
  float phase = fract(along / uDashSpacing - uTime * uFlowSpeed);
  float dash = smoothstep(0.0, 0.12, phase) * (1.0 - smoothstep(0.3, 0.55, phase));
  float intensity = clamp(vArc.z, 0.0, 1.0);
  float alpha = (0.45 + 0.55 * dash) * (0.4 + 0.6 * intensity) * uDensity;
  vec3 color = vColor * (0.9 + 0.8 * dash);
  gl_FragColor = vec4(color, alpha);
  ${OUTPUT_GLSL}
}
`;

export function createEdgeMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    name: "CodeVerseDependencyEdge",
    vertexShader: edgeVertexShader,
    fragmentShader: edgeFragmentShader,
    fog: true,
    transparent: true,
    depthWrite: false,
    // Keep the cyan -> violet direction gradient saturated (ACES would push it to white).
    toneMapped: false,
    uniforms: {
      ...fogUniforms(),
      uTime: { value: 0 },
      uDashSpacing: { value: 6 },
      uFlowSpeed: { value: 0.6 },
      uDensity: { value: 1 },
    },
  });
}

// ─── Ground ─────────────────────────────────────────────────────────────────

const groundVertexShader = /* glsl */ `
varying vec3 vWorldPosition;
#include <fog_pars_vertex>

void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vec4 mvPosition = viewMatrix * worldPosition;
  gl_Position = projectionMatrix * mvPosition;
  vWorldPosition = worldPosition.xyz;
  #include <fog_vertex>
}
`;

const groundFragmentShader = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uHalo;
uniform vec2 uCenter;
uniform float uRadius;

varying vec3 vWorldPosition;
#include <fog_pars_fragment>

void main() {
  // A faint pool of light under the city, like a holographic table.
  float d = distance(vWorldPosition.xz, uCenter);
  float halo = 1.0 - smoothstep(uRadius * 0.25, uRadius * 1.6, d);
  gl_FragColor = vec4(uColor + uHalo * halo * halo, 1.0);
  ${OUTPUT_GLSL}
}
`;

export function createGroundMaterial(color: Rgb, halo: Rgb): ShaderMaterial {
  return new ShaderMaterial({
    name: "CodeVerseGround",
    vertexShader: groundVertexShader,
    fragmentShader: groundFragmentShader,
    fog: true,
    depthWrite: false,
    uniforms: {
      ...fogUniforms(),
      uColor: { value: new Color(...color) },
      uHalo: { value: new Color(...halo) },
      uCenter: { value: new Vector2(0, 0) },
      uRadius: { value: 100 },
    },
  });
}

// ─── Selection beam ─────────────────────────────────────────────────────────

const beamVertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const beamFragmentShader = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying vec2 vUv;

void main() {
  // Fades in just above the roof, then out upward (CylinderGeometry: uv.y = 1 at the top),
  // so the beam never forms a hot spot where it meets the building.
  float fade = smoothstep(0.0, 0.12, vUv.y) * pow(1.0 - vUv.y, 2.2);
  gl_FragColor = vec4(uColor * fade * uOpacity, 1.0);
  #include <colorspace_fragment>
}
`;

/** Additive vertical light beam (color is premultiplied by the fade). */
export function createBeamMaterial(hex: string): ShaderMaterial {
  return new ShaderMaterial({
    name: "CodeVerseSelectionBeam",
    vertexShader: beamVertexShader,
    fragmentShader: beamFragmentShader,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    // An overlay, not a lit surface: keep the flare hue instead of ACES washing it to white.
    toneMapped: false,
    uniforms: {
      uColor: { value: new Color(...hexToLinear(hex)) },
      uOpacity: { value: 0 },
    },
  });
}
