import { baseName, parentPath } from "@/graph/model/ids";
import { isJsonObject, parseJsonc, type JsonObject } from "./jsonc";
import { packageNameOf } from "./npm-names";
import { joinPath } from "./paths";
import { compareTuples } from "../sort";

/**
 * JavaScript/TypeScript module probing, workspace packages and package.json
 * "exports"/"imports" maps.
 */

/** Extensions probed for extension-less specifiers, in TypeScript's preference order. */
const PROBE_EXTENSIONS = ["ts", "tsx", "d.ts", "js", "jsx", "mjs", "cjs", "mts", "cts", "json"];
const INDEX_EXTENSIONS = ["ts", "tsx", "d.ts", "js", "jsx", "mjs", "cjs"];
/** TypeScript ESM convention: "./x.js" in source refers to "./x.ts". */
const SOURCE_FOR_OUTPUT_EXTENSION: Readonly<Record<string, readonly string[]>> = {
  js: ["ts", "tsx"],
  jsx: ["tsx"],
  mjs: ["mts"],
  cjs: ["cts"],
};

/**
 * Finds the file a module path refers to: the exact file, the TypeScript source
 * of a ".js" path, the path plus a known extension, or a directory index file.
 */
export function probeModule(allPaths: ReadonlySet<string>, candidate: string): string | null {
  if (candidate !== "") {
    if (allPaths.has(candidate)) return candidate;
    const name = baseName(candidate);
    const dot = name.lastIndexOf(".");
    if (dot > 0) {
      const mapped = SOURCE_FOR_OUTPUT_EXTENSION[name.slice(dot + 1).toLowerCase()];
      const stem = candidate.slice(0, candidate.length - (name.length - dot));
      for (const extension of mapped ?? []) {
        const path = `${stem}.${extension}`;
        if (allPaths.has(path)) return path;
      }
    }
    for (const extension of PROBE_EXTENSIONS) {
      const path = `${candidate}.${extension}`;
      if (allPaths.has(path)) return path;
    }
  }
  const prefix = candidate === "" ? "" : `${candidate}/`;
  for (const extension of INDEX_EXTENSIONS) {
    const path = `${prefix}index.${extension}`;
    if (allPaths.has(path)) return path;
  }
  return null;
}

const BUILD_OUTPUT_SEGMENTS: ReadonlySet<string> = new Set([
  "dist",
  "build",
  "out",
  "esm",
  "cjs",
  "umd",
  "bundle",
]);

/** Committed build output (dist/, build/, ...): a worse edge target than the source file. */
function isBuildOutput(path: string): boolean {
  const segments = path.split("/");
  segments.pop();
  return segments.some((segment) => BUILD_OUTPUT_SEGMENTS.has(segment));
}

export interface WorkspacePackage {
  name: string;
  /** Directory containing the package.json ("" for the repository root). */
  directory: string;
  manifest: JsonObject;
}

/** Test fixtures often contain throwaway package.json files; real packages win name collisions. */
function isFixturePath(path: string): boolean {
  return /(^|\/)(test|tests|__tests__|fixtures?|__fixtures__|examples?|e2e)\//.test(path);
}

/** Parses every package.json in the config files. Invalid manifests are ignored. */
export function readManifests(configFiles: ReadonlyMap<string, string>): Map<string, JsonObject> {
  const manifests = new Map<string, JsonObject>();
  for (const [path, content] of configFiles) {
    if (baseName(path) !== "package.json") continue;
    const parsed = parseJsonc(content);
    if (isJsonObject(parsed)) manifests.set(parentPath(path), parsed);
  }
  return manifests;
}

/**
 * Maps package name -> workspace package for every manifest with a valid "name".
 * On collisions the non-fixture, shallowest, alphabetically first package wins.
 */
export function collectWorkspacePackages(
  manifests: ReadonlyMap<string, JsonObject>,
): Map<string, WorkspacePackage> {
  const entries = [...manifests.entries()].sort(([a], [b]) =>
    compareTuples(
      [isFixturePath(`${a}/`) ? 1 : 0, a === "" ? 0 : a.split("/").length, a],
      [isFixturePath(`${b}/`) ? 1 : 0, b === "" ? 0 : b.split("/").length, b],
    ),
  );
  const packages = new Map<string, WorkspacePackage>();
  for (const [directory, manifest] of entries) {
    const name = manifest.name;
    if (typeof name !== "string" || packageNameOf(name) !== name || packages.has(name)) continue;
    packages.set(name, { name, directory, manifest });
  }
  return packages;
}

/** Condition keys in order of preference; other conditions follow in declaration order. */
const CONDITION_ORDER = ["types", "import", "module", "default", "require"];

/** Flattens a (possibly nested) conditional export target into candidate strings, best first. */
export function conditionalTargets(value: unknown, depth = 0): string[] {
  if (depth > 8) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap((item) => conditionalTargets(item, depth + 1));
  if (!isJsonObject(value)) return [];
  const keys = Object.keys(value);
  const ordered = [
    ...CONDITION_ORDER.filter((key) => keys.includes(key)),
    ...keys.filter((key) => !CONDITION_ORDER.includes(key)),
  ];
  return ordered.flatMap((key) => conditionalTargets(value[key], depth + 1));
}

/**
 * Candidate targets for `subpath` ("." , "./utils", "#internal") in an
 * "exports" or "imports" field, following Node's rules: exact keys, then the
 * "*" pattern with the longest prefix (all "*" in the target are substituted),
 * then legacy folder mappings ("./": "./src/").
 */
export function subpathTargets(field: unknown, subpath: string): string[] {
  if (typeof field === "string" || Array.isArray(field)) {
    return subpath === "." ? conditionalTargets(field) : [];
  }
  if (!isJsonObject(field)) return [];
  const keys = Object.keys(field);
  if (!keys.some((key) => key.startsWith(".") || key.startsWith("#"))) {
    return subpath === "." ? conditionalTargets(field) : [];
  }
  if (Object.hasOwn(field, subpath)) return conditionalTargets(field[subpath]);

  let best: { key: string; replacement: string; prefixLength: number; folder: boolean } | null =
    null;
  for (const key of keys) {
    const star = key.indexOf("*");
    if (star === -1) {
      if (
        key.endsWith("/") &&
        subpath.startsWith(key) &&
        (!best || key.length > best.prefixLength)
      ) {
        best = {
          key,
          replacement: subpath.slice(key.length),
          prefixLength: key.length,
          folder: true,
        };
      }
      continue;
    }
    if (key.indexOf("*", star + 1) !== -1) continue;
    const prefix = key.slice(0, star);
    const suffix = key.slice(star + 1);
    if (
      subpath.length >= prefix.length + suffix.length &&
      subpath.startsWith(prefix) &&
      subpath.endsWith(suffix) &&
      (!best || prefix.length > best.prefixLength)
    ) {
      const replacement = subpath.slice(prefix.length, subpath.length - suffix.length);
      best = { key, replacement, prefixLength: prefix.length, folder: false };
    }
  }
  if (!best) return [];
  const match = best;
  return conditionalTargets(field[match.key]).map((target) =>
    match.folder ? `${target}${match.replacement}` : target.split("*").join(match.replacement),
  );
}

/**
 * Resolves `subpath` ("" for the package root) inside a workspace package to a
 * repository file: "exports" first, then "source"/"module"/"main"/"types"
 * fields and src/index.*, index.* (subpaths: the package dir, then its src/).
 * Source files are preferred over committed build output.
 */
export function resolvePackageEntry(
  pkg: WorkspacePackage,
  subpath: string,
  probe: (candidate: string) => string | null,
): string | null {
  const candidates: Array<string | null> = [];
  const exportsField = pkg.manifest.exports;
  if (exportsField !== undefined) {
    for (const target of subpathTargets(exportsField, subpath === "" ? "." : `./${subpath}`)) {
      if (target.startsWith("./")) candidates.push(joinPath(pkg.directory, target));
    }
  }
  if (subpath === "") {
    for (const field of ["source", "module", "main", "types", "typings"]) {
      const value = pkg.manifest[field];
      if (typeof value === "string" && value !== "")
        candidates.push(joinPath(pkg.directory, value));
    }
    candidates.push(joinPath(pkg.directory, "src/index"), joinPath(pkg.directory, "index"));
  } else {
    candidates.push(joinPath(pkg.directory, subpath), joinPath(pkg.directory, `src/${subpath}`));
  }

  let fallback: string | null = null;
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (candidate === null || seen.has(candidate)) continue;
    seen.add(candidate);
    const hit = probe(candidate);
    if (hit === null) continue;
    if (!isBuildOutput(hit)) return hit;
    fallback ??= hit;
  }
  return fallback;
}
