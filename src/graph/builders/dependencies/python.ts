import { baseName, parentPath } from "@/graph/model/ids";
import { detectCategory } from "@/lib/languages/registry";
import type { ParsedImport } from "@/parser/types";
import { joinPath, isWithin } from "./paths";
import { isTomlTable, parseToml, tomlGet } from "./toml";
import { compareTuples } from "../sort";
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
 * Python import resolution.
 *
 * Absolute imports are looked up in a module index built from every .py/.pyi
 * file under plausible source roots: the repository root, "src/", parents of
 * top-level packages (a package whose parent is not a package), directories
 * with pyproject.toml/setup.py/setup.cfg and package dirs they declare. The
 * importer's own script directory (the first ancestor that is not a package)
 * also counts, mirroring how `python script.py` and pytest extend sys.path.
 * The longest importable prefix wins; among candidates, roots containing the
 * importer (deepest first) are preferred.
 *
 * Relative imports walk up from the importer's package, one level per extra dot.
 */

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const PYTHON_FILE = /\.pyi?$/;
const PROJECT_FILES: ReadonlySet<string> = new Set(["pyproject.toml", "setup.py", "setup.cfg"]);

/** setup.cfg / setup.py are scanned with regular expressions; only their head is read. */
export const MAX_SETUP_SCAN_CHARS = 64 * 1024;

/**
 * package_dir / find-where declarations of setup.cfg and setup.py. Adjacent
 * whitespace runs never overlap (they are separated by a literal, or limited to
 * spaces and tabs around a newline), so each pattern runs in linear time on
 * hostile input. Resolution runs synchronously on the server's event loop.
 */
const SETUP_PATTERNS: readonly RegExp[] = [
  // setup(package_dir={"": "src"}), possibly spread over several lines.
  /package_dir\s*=\s*\{\s*["']{2}\s*:\s*["']([^"'\n]+)["']/g,
  // [options]
  // package_dir =
  //     = src
  /package_dir[ \t]*=[ \t]*\r?\n[ \t]*=[ \t]*([^\s#]+)/g,
  // [options.packages.find]
  // where = src
  /where[ \t]*=[ \t]*([A-Za-z0-9_./-]+)[ \t]*\r?$/gm,
];

interface ModuleCandidate {
  path: string;
  root: string;
  isPackage: boolean;
  isStub: boolean;
}

/** Converts a root-relative file path to a dotted module name, or null when not importable. */
function moduleNameOf(relativePath: string): { name: string; isPackage: boolean } | null {
  const segments = relativePath.replace(PYTHON_FILE, "").split("/");
  const isPackage = segments[segments.length - 1] === "__init__";
  if (isPackage) segments.pop();
  if (segments.length === 0 || !segments.every((segment) => IDENTIFIER.test(segment))) return null;
  return { name: segments.join("."), isPackage };
}

/** Package directories declared by pyproject.toml / setup.cfg / setup.py (e.g. "src"). */
function declaredSourceDirectories(path: string, content: string): string[] {
  const directory = parentPath(path);
  const declared: string[] = [];
  const name = baseName(path);
  if (name === "pyproject.toml") {
    const toml = parseToml(content);
    const where = tomlGet(toml, "tool", "setuptools", "packages", "find", "where");
    if (Array.isArray(where))
      declared.push(...where.filter((item): item is string => typeof item === "string"));
    const packageDir = tomlGet(toml, "tool", "setuptools", "package-dir");
    if (isTomlTable(packageDir) && typeof packageDir[""] === "string")
      declared.push(packageDir[""]);
    const poetryPackages = tomlGet(toml, "tool", "poetry", "packages");
    if (Array.isArray(poetryPackages)) {
      for (const entry of poetryPackages) {
        if (isTomlTable(entry) && typeof entry.from === "string") declared.push(entry.from);
      }
    }
    const hatchPackages = tomlGet(toml, "tool", "hatch", "build", "targets", "wheel", "packages");
    if (Array.isArray(hatchPackages)) {
      for (const entry of hatchPackages)
        if (typeof entry === "string") declared.push(parentPath(entry));
    }
  } else {
    const head = content.slice(0, MAX_SETUP_SCAN_CHARS);
    for (const pattern of SETUP_PATTERNS) {
      for (const match of head.matchAll(pattern)) if (match[1]) declared.push(match[1]);
    }
  }
  return declared
    .map((relative) => joinPath(directory, relative))
    .filter((resolved): resolved is string => resolved !== null);
}

export function createPythonResolver(context: ResolverContext): LanguageResolver {
  // Vendored trees (a committed .venv, site-packages) must not shadow real third-party packages.
  const pythonPaths = [...context.allPaths]
    .filter((path) => PYTHON_FILE.test(path) && detectCategory(path) !== "vendor")
    .sort();
  const packageDirectories = new Set<string>();
  for (const path of pythonPaths) {
    if (/(^|\/)__init__\.pyi?$/.test(path)) packageDirectories.add(parentPath(path));
  }

  const roots = new Set<string>([""]);
  if (pythonPaths.some((path) => path.startsWith("src/"))) roots.add("src");
  for (const directory of packageDirectories) {
    if (directory === "") continue;
    const parent = parentPath(directory);
    if (!packageDirectories.has(parent) || parent === "") roots.add(parent);
  }
  for (const path of context.allPaths) {
    if (PROJECT_FILES.has(baseName(path))) roots.add(parentPath(path));
  }
  for (const [path, content] of context.configFiles) {
    if (!PROJECT_FILES.has(baseName(path))) continue;
    for (const directory of declaredSourceDirectories(path, content)) roots.add(directory);
  }

  const index = new Map<string, ModuleCandidate[]>();
  for (const path of pythonPaths) {
    let directory = parentPath(path);
    for (;;) {
      if (roots.has(directory)) {
        const relative = directory === "" ? path : path.slice(directory.length + 1);
        const moduleInfo = moduleNameOf(relative);
        if (moduleInfo) {
          const candidate: ModuleCandidate = {
            path,
            root: directory,
            isPackage: moduleInfo.isPackage,
            isStub: path.endsWith(".pyi"),
          };
          const list = index.get(moduleInfo.name);
          if (list) list.push(candidate);
          else index.set(moduleInfo.name, [candidate]);
        }
      }
      if (directory === "") break;
      directory = parentPath(directory);
    }
  }

  /** First ancestor directory of the importer that is not a package (its sys.path entry as a script). */
  function scriptRootOf(importer: string): string {
    let directory = parentPath(importer);
    while (directory !== "" && packageDirectories.has(directory)) directory = parentPath(directory);
    return directory;
  }

  /**
   * Module file at `base` (a path without extension), in import-system order:
   * a regular package wins over a module file; sources win over stubs.
   * With `packageOnly`, only base/__init__.py(i) is considered.
   */
  function probeModuleFile(base: string, packageOnly = false): ModuleCandidate | null {
    const prefix = base === "" ? "" : `${base}/`;
    const options: Array<[string, boolean]> =
      packageOnly || base === ""
        ? [
            [`${prefix}__init__.py`, true],
            [`${prefix}__init__.pyi`, true],
          ]
        : [
            [`${prefix}__init__.py`, true],
            [`${base}.py`, false],
            [`${prefix}__init__.pyi`, true],
            [`${base}.pyi`, false],
          ];
    for (const [path, isPackage] of options) {
      if (context.allPaths.has(path))
        return { path, root: "", isPackage, isStub: path.endsWith(".pyi") };
    }
    return null;
  }

  function pickCandidate(
    candidates: readonly ModuleCandidate[],
    importer: string,
  ): ModuleCandidate | null {
    let best: ModuleCandidate | null = null;
    let bestKey: Array<number | string> = [];
    for (const candidate of candidates) {
      const contains = isWithin(importer, candidate.root);
      const key = [
        contains ? 0 : 1,
        contains ? -candidate.root.length : candidate.root.length,
        candidate.isStub ? 1 : 0,
        candidate.isPackage ? 0 : 1,
        candidate.path,
      ];
      if (!best || compareTuples(key, bestKey) < 0) {
        best = candidate;
        bestKey = key;
      }
    }
    return best;
  }

  /** Exact module lookup (no prefix fallback). */
  function lookupModule(name: string, importer: string): string | null {
    const scriptRoot = scriptRootOf(importer);
    const candidates = [...(index.get(name) ?? [])];
    if (!roots.has(scriptRoot)) {
      const direct = probeModuleFile(joinPath(scriptRoot, name.split(".").join("/")) ?? "");
      if (direct) candidates.push({ ...direct, root: scriptRoot });
    }
    return pickCandidate(candidates, importer)?.path ?? null;
  }

  function resolveAbsolute(
    file: DependencyInputFile,
    specifier: string,
    names: readonly string[],
  ): Resolution {
    const segments = specifier.split(".");
    if (!segments.every((segment) => IDENTIFIER.test(segment))) return UNRESOLVED;
    const submodules: string[] = [];
    let allSubmodules = names.length > 0;
    for (const name of names) {
      const hit = IDENTIFIER.test(name) ? lookupModule(`${specifier}.${name}`, file.path) : null;
      if (hit) submodules.push(hit);
      else allSubmodules = false;
    }
    if (allSubmodules) return internal(submodules);
    for (let length = segments.length; length > 0; length -= 1) {
      const hit = lookupModule(segments.slice(0, length).join("."), file.path);
      if (hit) return internal([hit, ...submodules]);
    }
    return external(segments[0] ?? specifier);
  }

  function resolveRelative(
    file: DependencyInputFile,
    specifier: string,
    names: readonly string[],
  ): Resolution {
    const dots = /^\.+/.exec(specifier)?.[0].length ?? 0;
    const rest = specifier.slice(dots);
    let base = parentPath(file.path);
    for (let level = 1; level < dots; level += 1) {
      if (base === "") return UNRESOLVED;
      base = parentPath(base);
    }
    if (rest !== "") {
      const restSegments = rest.split(".");
      if (!restSegments.every((segment) => IDENTIFIER.test(segment))) return UNRESOLVED;
      base = joinPath(base, restSegments.join("/")) ?? "";
    }
    const targets: string[] = [];
    let needsBase = names.length === 0;
    for (const name of names) {
      const hit = IDENTIFIER.test(name) ? probeModuleFile(joinPath(base, name) ?? "") : null;
      if (hit && hit.path !== file.path) targets.push(hit.path);
      else needsBase = true;
    }
    if (needsBase) {
      const packageModule = probeModuleFile(base, rest === "");
      if (!packageModule) return targets.length > 0 ? internal(targets) : UNRESOLVED;
      targets.unshift(packageModule.path);
    }
    return internal(targets);
  }

  function resolve(file: DependencyInputFile, imported: ParsedImport): Resolution {
    const specifier = imported.specifier.trim();
    if (specifier === "") return UNRESOLVED;
    const names = (imported.names ?? []).map((name) => name.trim().split(/\s+as\s+/)[0] ?? "");
    const importedNames = names.filter((name) => name !== "" && name !== "*");
    if (specifier.startsWith(".")) return resolveRelative(file, specifier, importedNames);
    return resolveAbsolute(file, specifier, importedNames);
  }

  return { resolve };
}
