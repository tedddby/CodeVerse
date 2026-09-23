import { baseName, parentPath } from "@/graph/model/ids";
import type { ParsedImport } from "@/parser/types";
import { ancestorDirectories, joinPath, relativeTo, isWithin } from "./paths";
import { parseToml, tomlGet } from "./toml";
import { compareStrings, directoryDepthOf } from "../sort";
import {
  UNRESOLVED,
  external,
  internal,
  type DependencyInputFile,
  type LanguageResolver,
  type Resolution,
  type ResolverContext,
} from "./types";

/**
 * Rust module and `use` resolution.
 *
 * Crates come from every Cargo.toml with a [package] (lib root from [lib] path,
 * default src/lib.rs; binary root src/main.rs). Each file gets a module scope:
 * the directory its crate root lives in (src/, src/bin/, tests/, ...) and its
 * module path inside that crate. `mod foo;` resolves to foo.rs or foo/mod.rs
 * next to mod-rs files (crate roots, mod.rs) or inside src/a/ for src/a.rs.
 * `use` paths (crate::, self::, super::, workspace crate names, or child
 * modules) resolve to the longest prefix that maps to a file, so items defined
 * inline still point at the file that defines their module. `std`, `core` and
 * `alloc` are external "std"; other first segments are external crates.
 */

const STANDARD_CRATES: ReadonlySet<string> = new Set(["std", "core", "alloc"]);
const SEPARATE_ROOT_DIRECTORIES: ReadonlySet<string> = new Set(["tests", "benches", "examples"]);

interface Crate {
  /** Crate name as written in code (hyphens replaced by underscores). */
  name: string;
  directory: string;
  libRoot: string | null;
  mainRoot: string | null;
}

interface ModuleScope {
  /** Directory holding the crate root's child modules. */
  rootDirectory: string;
  /** The crate root file, when known. */
  rootFile: string | null;
  /** Module path of the current file inside its crate ([] for a crate root). */
  modulePath: string[];
}

/** Expands a use tree ("a::{b, c::{d, self}}") into flat paths; strips aliases and whitespace. */
export function expandUseTree(tree: string): string[] {
  const compact = tree
    .replace(/\s+as\s+[A-Za-z_][A-Za-z0-9_]*/g, "")
    .replace(/\s+/g, "")
    .replace(/;$/, "");
  return expand(compact, 0);
}

function expand(tree: string, depth: number): string[] {
  const open = tree.indexOf("{");
  if (open === -1 || depth > 16) return tree === "" ? [] : [tree];
  let level = 0;
  let close = -1;
  for (let index = open; index < tree.length; index += 1) {
    if (tree[index] === "{") level += 1;
    else if (tree[index] === "}") {
      level -= 1;
      if (level === 0) {
        close = index;
        break;
      }
    }
  }
  const prefix = tree.slice(0, open);
  const inner = tree.slice(open + 1, close === -1 ? tree.length : close);
  const items: string[] = [];
  level = 0;
  let start = 0;
  for (let index = 0; index <= inner.length; index += 1) {
    const char = inner[index];
    if (char === "{") level += 1;
    else if (char === "}") level -= 1;
    else if ((char === "," && level === 0) || index === inner.length) {
      items.push(inner.slice(start, index));
      start = index + 1;
    }
  }
  const result: string[] = [];
  for (const item of items) {
    for (const path of expand(item, depth + 1)) {
      result.push(path === "self" ? prefix.replace(/::$/, "") : `${prefix}${path}`);
    }
  }
  return result.filter((path) => path !== "");
}

function normalizeSegment(segment: string): string {
  return segment.startsWith("r#") ? segment.slice(2) : segment;
}

export function createRustResolver(context: ResolverContext): LanguageResolver {
  const cratesByDirectory = new Map<string, Crate>();
  const cratesByName = new Map<string, Crate>();
  const manifests = [...context.configFiles.keys()]
    .filter((path) => baseName(path) === "Cargo.toml")
    .sort((a, b) => directoryDepthOf(a) - directoryDepthOf(b) || compareStrings(a, b));
  for (const path of manifests) {
    const toml = parseToml(context.configFiles.get(path) ?? "");
    const packageName = tomlGet(toml, "package", "name");
    if (typeof packageName !== "string" || packageName === "") continue;
    const directory = parentPath(path);
    const libPath = tomlGet(toml, "lib", "path");
    const libRoot = joinPath(directory, typeof libPath === "string" ? libPath : "src/lib.rs");
    const mainRoot = joinPath(directory, "src/main.rs");
    const libName = tomlGet(toml, "lib", "name");
    const crate: Crate = {
      name: (typeof libName === "string" ? libName : packageName).replace(/-/g, "_"),
      directory,
      libRoot: libRoot !== null && context.allPaths.has(libRoot) ? libRoot : null,
      mainRoot: mainRoot !== null && context.allPaths.has(mainRoot) ? mainRoot : null,
    };
    cratesByDirectory.set(directory, crate);
    if (!cratesByName.has(crate.name)) cratesByName.set(crate.name, crate);
  }

  function crateOf(path: string): Crate | null {
    for (const directory of ancestorDirectories(path)) {
      const crate = cratesByDirectory.get(directory);
      if (crate) return crate;
    }
    return null;
  }

  function libraryScope(crate: Crate): ModuleScope | null {
    const rootFile = crate.libRoot ?? crate.mainRoot;
    if (rootFile === null) return null;
    return { rootDirectory: parentPath(rootFile), rootFile, modulePath: [] };
  }

  const scopes = new Map<string, ModuleScope>();
  function scopeOf(path: string): ModuleScope {
    const cached = scopes.get(path);
    if (cached) return cached;
    const scope = computeScope(path);
    scopes.set(path, scope);
    return scope;
  }

  function computeScope(path: string): ModuleScope {
    const crate = crateOf(path);
    let rootDirectory: string;
    let separateRoot = false;
    if (crate) {
      const segments = relativeTo(path, crate.directory).split("/");
      const prefix = crate.directory === "" ? "" : `${crate.directory}/`;
      if (segments[0] === "src" && segments[1] === "bin" && segments.length >= 3) {
        separateRoot = true;
        rootDirectory =
          segments.length === 4 && segments[3] === "main.rs"
            ? `${prefix}src/bin/${segments[2]}`
            : `${prefix}src/bin`;
      } else if (SEPARATE_ROOT_DIRECTORIES.has(segments[0] ?? "") && segments.length >= 2) {
        separateRoot = true;
        rootDirectory =
          segments.length === 3 && segments[2] === "main.rs"
            ? `${prefix}${segments[0]}/${segments[1]}`
            : `${prefix}${segments[0]}`;
      } else if (crate.libRoot && isWithin(path, parentPath(crate.libRoot))) {
        rootDirectory = parentPath(crate.libRoot);
      } else if (segments[0] === "src") {
        rootDirectory = `${prefix}src`;
      } else {
        // build.rs and other files outside the crate's source tree are crate roots of their own.
        separateRoot = true;
        rootDirectory = parentPath(path);
      }
    } else {
      rootDirectory =
        ancestorDirectories(path).find((directory) => baseName(directory) === "src") ??
        parentPath(path);
    }

    const segments = relativeTo(path, rootDirectory).split("/");
    const stem = (segments.pop() ?? "").replace(/\.rs$/, "");
    const isCrateRoot =
      segments.length === 0 &&
      (separateRoot || stem === "lib" || stem === "main" || path === crate?.libRoot);
    const modulePath = isCrateRoot ? [] : stem === "mod" ? segments : [...segments, stem];
    const rootFile = isCrateRoot
      ? path
      : separateRoot
        ? null
        : (crate?.libRoot ?? crate?.mainRoot ?? null);
    return { rootDirectory, rootFile, modulePath };
  }

  /** File defining the module at `modulePath` of a scope's crate, if it exists. */
  function moduleFile(scope: ModuleScope, modulePath: readonly string[]): string | null {
    if (modulePath.length === 0) return scope.rootFile;
    const base = joinPath(scope.rootDirectory, modulePath.join("/"));
    if (base === null) return null;
    for (const candidate of [`${base}.rs`, `${base}/mod.rs`]) {
      if (context.allPaths.has(candidate)) return candidate;
    }
    return null;
  }

  /** Longest prefix of `rest` (below `base`) that maps to a file. */
  function longestModule(
    scope: ModuleScope,
    base: readonly string[],
    rest: readonly string[],
  ): string | null {
    for (let length = rest.length; length >= 0; length -= 1) {
      const file = moduleFile(scope, [...base, ...rest.slice(0, length)]);
      if (file) return file;
    }
    return null;
  }

  function resolveUsePath(scope: ModuleScope, path: string): Resolution {
    const segments = path
      .replace(/^::/, "")
      .split("::")
      .map(normalizeSegment)
      .filter((segment) => segment !== "");
    if (segments[segments.length - 1] === "*") segments.pop();
    const first = segments[0];
    if (first === undefined) return UNRESOLVED;

    if (first === "crate" || first === "$crate")
      return found(longestModule(scope, [], segments.slice(1)));
    if (first === "self") return found(longestModule(scope, scope.modulePath, segments.slice(1)));
    if (first === "super") {
      let supers = 0;
      while (segments[supers] === "super") supers += 1;
      if (supers > scope.modulePath.length) return UNRESOLVED;
      const base = scope.modulePath.slice(0, scope.modulePath.length - supers);
      return found(longestModule(scope, base, segments.slice(supers)));
    }
    const workspaceCrate = cratesByName.get(first);
    if (workspaceCrate) {
      const crateScope = libraryScope(workspaceCrate);
      return crateScope ? found(longestModule(crateScope, [], segments.slice(1))) : UNRESOLVED;
    }
    if (STANDARD_CRATES.has(first)) return external("std");
    // Uniform paths: a child module of the current module, then (2015 edition) of the crate root.
    if (moduleFile(scope, [...scope.modulePath, first])) {
      return found(longestModule(scope, scope.modulePath, segments));
    }
    if (scope.modulePath.length > 0 && moduleFile(scope, [first])) {
      return found(longestModule(scope, [], segments));
    }
    return external(first);
  }

  function resolve(file: DependencyInputFile, imported: ParsedImport): Resolution {
    const scope = scopeOf(file.path);
    const specifier = imported.specifier.trim();
    if (specifier === "") return UNRESOLVED;

    if (imported.kind === "module") {
      // `mod x;` declared inside inline modules arrives as "outer::inner::x": the file
      // lives below the current module's directory along that inline path.
      const segments = specifier
        .replace(/^(pub(\([^)]*\))?\s+)?mod\s+/, "")
        .replace(/;$/, "")
        .split("::")
        .map((segment) => normalizeSegment(segment.trim()))
        .filter((segment) => segment !== "");
      if (segments.length === 0) return UNRESOLVED;
      return found(moduleFile(scope, [...scope.modulePath, ...segments]));
    }

    let paths = expandUseTree(specifier);
    const names = (imported.names ?? [])
      .map((name) => name.trim().split(/\s+as\s+/)[0] ?? "")
      .filter((name) => name !== "" && name !== "*" && name !== "self");
    const single = paths[0];
    if (
      names.length > 0 &&
      paths.length === 1 &&
      single !== undefined &&
      !specifier.includes("{")
    ) {
      const last = single.split("::").pop() ?? "";
      if (!names.includes(last) && last !== "*") paths = names.map((name) => `${single}::${name}`);
    }

    const targets: string[] = [];
    let externalName: string | null = null;
    for (const path of paths) {
      const resolution = resolveUsePath(scope, path);
      if (resolution.type === "internal") {
        for (const target of resolution.paths) if (!targets.includes(target)) targets.push(target);
      } else if (resolution.type === "external") externalName ??= resolution.name;
    }
    if (targets.length > 0) return internal(targets);
    return externalName !== null ? external(externalName) : UNRESOLVED;
  }

  return { resolve };
}

function found(file: string | null): Resolution {
  return file ? internal([file]) : UNRESOLVED;
}
