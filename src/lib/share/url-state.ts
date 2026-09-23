import { z } from "zod";
import { nodeRefFromId } from "@/graph/model/ids";
import type { NodeRef } from "@/graph/model/types";
import { VISUAL_MODES, type CameraPose, type NavigationMode, type VisualMode } from "@/state/explorer-store";
import { explorePath, isValidRef } from "@/lib/validation/repository-url";

/**
 * Explorer view state encoded in shareable URLs, e.g.
 *
 *   /explore/facebook/react?mode=dependencies&sel=file:packages/react/index.js
 *     &deps=1&cam=120.5,80,-42.25,0,0,0
 *
 * Every value read from a URL is untrusted. Decoding validates each parameter
 * independently and silently drops anything invalid, so a tampered or
 * truncated link still opens the repository with whatever parts are valid.
 */

export interface ShareState {
  mode?: VisualMode;
  selection?: NodeRef;
  camera?: CameraPose;
  /** Dependency lines visible. */
  deps?: boolean;
  nav?: NavigationMode;
  /** Branch, tag or commit SHA ("pin to this commit"). */
  ref?: string;
  /** Highlighted contributor id ("user:<login>" or "author:<name>"). */
  contributor?: string;
  /** Timeline cursor, epoch milliseconds. */
  t?: number;
}

/** Query parameter names. Short on purpose: links get pasted into chats. */
export const SHARE_PARAMS = {
  ref: "ref",
  mode: "mode",
  selection: "sel",
  deps: "deps",
  nav: "nav",
  contributor: "contributor",
  t: "t",
  camera: "cam",
} as const;

/** Upper bound for node ids (paths are capped at 1,024 characters by the analyzer). */
export const MAX_NODE_ID_LENGTH = 1_400;
export const MAX_CONTRIBUTOR_ID_LENGTH = 200;
/** Camera coordinates are clamped to this magnitude (world units). */
export const MAX_CAMERA_COORDINATE = 1_000_000;
/** Timeline cursor bounds: 1970 .. 2200. */
const MAX_TIMESTAMP = Date.UTC(2200, 0, 1);

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

const modeSchema = z.enum(VISUAL_MODES.map((mode) => mode.id) as [VisualMode, ...VisualMode[]]);
const navSchema = z.enum(["orbit", "explore"]);
const booleanFlagSchema = z.enum(["1", "0", "true", "false"]).transform((value) => value === "1" || value === "true");

const nodeIdSchema = z
  .string()
  .min(4)
  .max(MAX_NODE_ID_LENGTH)
  .refine((value) => !CONTROL_CHARACTERS.test(value), "control characters")
  .refine((value) => value.startsWith("file:") || value.startsWith("dir:") || value.startsWith("sym:"), "prefix")
  .refine((value) => {
    // A file or symbol id needs a path; "dir:" alone is the root directory.
    if (value.startsWith("file:")) return value.length > 5;
    if (value.startsWith("sym:")) return value.length > 4 && value.includes("#");
    return true;
  }, "empty path");

const contributorSchema = z
  .string()
  .max(MAX_CONTRIBUTOR_ID_LENGTH)
  .refine((value) => !CONTROL_CHARACTERS.test(value), "control characters")
  .refine((value) => /^(user|author):.+$/s.test(value), "prefix");

const coordinateSchema = z.number().min(-MAX_CAMERA_COORDINATE).max(MAX_CAMERA_COORDINATE);

const cameraSchema = z
  .string()
  .max(160)
  .transform((value, context) => {
    const parts = value.split(",");
    if (parts.length !== 6 || parts.some((part) => !/^-?\d+(\.\d+)?(e[-+]?\d+)?$/i.test(part.trim()))) {
      context.addIssue({ code: "custom", message: "expected six numbers" });
      return z.NEVER;
    }
    return parts.map(Number);
  })
  .pipe(z.tuple([coordinateSchema, coordinateSchema, coordinateSchema, coordinateSchema, coordinateSchema, coordinateSchema]));

const timestampSchema = z
  .string()
  .regex(/^\d{1,16}$/)
  .transform(Number)
  .pipe(z.number().int().min(0).max(MAX_TIMESTAMP));

const refSchema = z.string().refine(isValidRef, "invalid ref");

function roundCoordinate(value: number): number {
  const rounded = Math.round(value * 100) / 100;
  // Avoid "-0" in URLs.
  return Object.is(rounded, -0) ? 0 : rounded;
}

/** "x,y,z,tx,ty,tz" with at most two decimals. */
export function encodeCamera(pose: CameraPose): string {
  return [...pose.position, ...pose.target].map((value) => String(roundCoordinate(value))).join(",");
}

function isFiniteCamera(pose: CameraPose): boolean {
  return [...pose.position, ...pose.target].every(
    (value) => Number.isFinite(value) && Math.abs(value) <= MAX_CAMERA_COORDINATE,
  );
}

/** Serializes view state into query parameters in a stable order. Invalid values are omitted. */
export function encodeShareState(state: ShareState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.ref && isValidRef(state.ref)) params.set(SHARE_PARAMS.ref, state.ref);
  if (state.mode && modeSchema.safeParse(state.mode).success) params.set(SHARE_PARAMS.mode, state.mode);
  if (state.selection && nodeIdSchema.safeParse(state.selection.id).success) {
    params.set(SHARE_PARAMS.selection, state.selection.id);
  }
  if (state.deps !== undefined) params.set(SHARE_PARAMS.deps, state.deps ? "1" : "0");
  if (state.nav) params.set(SHARE_PARAMS.nav, state.nav);
  if (state.contributor && contributorSchema.safeParse(state.contributor).success) {
    params.set(SHARE_PARAMS.contributor, state.contributor);
  }
  if (state.t !== undefined && Number.isInteger(state.t) && state.t >= 0 && state.t <= MAX_TIMESTAMP) {
    params.set(SHARE_PARAMS.t, String(state.t));
  }
  if (state.camera && isFiniteCamera(state.camera)) params.set(SHARE_PARAMS.camera, encodeCamera(state.camera));
  return params;
}

/** Parses view state from query parameters; every invalid value is dropped silently. */
export function decodeShareState(params: URLSearchParams): ShareState {
  const state: ShareState = {};
  const read = <T>(name: string, schema: z.ZodType<T>): T | undefined => {
    const raw = params.get(name);
    if (raw === null) return undefined;
    const result = schema.safeParse(raw);
    return result.success ? result.data : undefined;
  };

  const ref = read(SHARE_PARAMS.ref, refSchema);
  if (ref !== undefined) state.ref = ref;

  const mode = read(SHARE_PARAMS.mode, modeSchema);
  if (mode !== undefined) state.mode = mode;

  const selectionId = read(SHARE_PARAMS.selection, nodeIdSchema);
  const selection = selectionId !== undefined ? nodeRefFromId(selectionId) : null;
  if (selection) state.selection = selection;

  const deps = read(SHARE_PARAMS.deps, booleanFlagSchema);
  if (deps !== undefined) state.deps = deps;

  const nav = read(SHARE_PARAMS.nav, navSchema);
  if (nav !== undefined) state.nav = nav;

  const contributor = read(SHARE_PARAMS.contributor, contributorSchema);
  if (contributor !== undefined) state.contributor = contributor;

  const t = read(SHARE_PARAMS.t, timestampSchema);
  if (t !== undefined) state.t = t;

  const camera = read(SHARE_PARAMS.camera, cameraSchema);
  if (camera !== undefined) {
    const [x, y, z, tx, ty, tz] = camera;
    state.camera = { position: [x, y, z], target: [tx, ty, tz] };
  }
  return state;
}

/** Converts Next.js `searchParams` (string | string[] | undefined values) into URLSearchParams. */
export function searchParamsFromRecord(record: Record<string, string | string[] | undefined>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === "string") params.append(key, value);
    else if (Array.isArray(value)) for (const item of value) params.append(key, item);
  }
  return params;
}

/** Absolute explorer URL for a repository with the given view state. */
export function buildShareUrl(origin: string, owner: string, repo: string, state: ShareState): string {
  const base = origin.replace(/\/+$/, "");
  const query = encodeShareState(state).toString();
  return `${base}${explorePath(owner, repo)}${query ? `?${query}` : ""}`;
}
