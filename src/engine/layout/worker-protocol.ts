import { computeWorldLayout } from "./compute-layout";
import type { LayoutGraphInput } from "./layout-input";
import type { LayoutOptions, WorldLayout } from "./types";

/**
 * Message protocol between the main thread and the layout worker.
 *
 *   main -> worker: { type: "compute", requestId, graph, options? }
 *   worker -> main: { type: "result", requestId, layout }
 *                 | { type: "error", requestId, message }
 *
 * `graph` is a `LayoutGraphInput` (usually the compact copy made by
 * `toLayoutInput`, but a full `RepositoryGraph` is accepted too).
 * The handler is a pure function so it can be unit-tested without a Worker.
 */
export interface LayoutComputeRequest {
  type: "compute";
  requestId: number;
  graph: LayoutGraphInput;
  options?: Partial<LayoutOptions>;
}

export interface LayoutResultResponse {
  type: "result";
  requestId: number;
  layout: WorldLayout;
}

export interface LayoutErrorResponse {
  type: "error";
  requestId: number;
  message: string;
}

export type LayoutWorkerResponse = LayoutResultResponse | LayoutErrorResponse;

type LayoutComputer = (graph: LayoutGraphInput, options?: Partial<LayoutOptions>) => WorldLayout;

const OPTION_KEYS: ReadonlyArray<keyof LayoutOptions> = [
  "districtPadding",
  "buildingGap",
  "minFootprint",
  "maxFootprint",
  "minHeight",
  "maxHeight",
  "slabHeight",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isRequestId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function everyItem(value: unknown, check: (item: Record<string, unknown>) => boolean): boolean {
  if (!Array.isArray(value)) return false;
  for (const item of value) if (!isRecord(item) || !check(item)) return false;
  return true;
}

function isDirectoryInput(item: Record<string, unknown>): boolean {
  return (
    typeof item.id === "string" &&
    typeof item.path === "string" &&
    typeof item.name === "string" &&
    (item.parentId === null || typeof item.parentId === "string") &&
    isRecord(item.stats)
  );
}

function isFileInput(item: Record<string, unknown>): boolean {
  return (
    typeof item.id === "string" &&
    typeof item.path === "string" &&
    typeof item.directoryId === "string" &&
    typeof item.size === "number" &&
    typeof item.lines === "number" &&
    typeof item.status === "string"
  );
}

function isDependencyInput(item: Record<string, unknown>): boolean {
  return typeof item.source === "string" && typeof item.target === "string";
}

/** Structural validation of an untrusted `LayoutGraphInput` (O(n), no deep copies). */
export function isLayoutGraphInput(value: unknown): value is LayoutGraphInput {
  if (!isRecord(value) || typeof value.rootDirectoryId !== "string") return false;
  const repository = value.repository;
  if (!isRecord(repository)) return false;
  if (typeof repository.id !== "string" || typeof repository.commitSha !== "string") return false;
  return (
    everyItem(value.directories, isDirectoryInput) &&
    everyItem(value.files, isFileInput) &&
    everyItem(value.dependencies, isDependencyInput)
  );
}

function readOptions(value: unknown): Partial<LayoutOptions> | undefined {
  if (!isRecord(value)) return undefined;
  const options: Partial<LayoutOptions> = {};
  for (const key of OPTION_KEYS) {
    const option = value[key];
    if (typeof option === "number") options[key] = option;
  }
  return options;
}

export function isLayoutWorkerResponse(value: unknown): value is LayoutWorkerResponse {
  if (!isRecord(value) || !isRequestId(value.requestId)) return false;
  if (value.type === "result") return isRecord(value.layout);
  if (value.type === "error") return typeof value.message === "string";
  return false;
}

function describeError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "Unknown layout error";
}

/**
 * Handles one message received by the worker. Returns the response to post,
 * or null for messages that are not layout requests (they are ignored, since
 * without a request id there is nobody to answer).
 */
export function handleLayoutWorkerMessage(
  data: unknown,
  compute: LayoutComputer = computeWorldLayout,
): LayoutWorkerResponse | null {
  if (!isRecord(data) || data.type !== "compute" || !isRequestId(data.requestId)) return null;
  const requestId = data.requestId;
  if (!isLayoutGraphInput(data.graph)) {
    return { type: "error", requestId, message: "Layout request did not contain a valid graph" };
  }
  try {
    const layout = compute(data.graph, readOptions(data.options));
    return { type: "result", requestId, layout };
  } catch (error) {
    return { type: "error", requestId, message: describeError(error) };
  }
}
