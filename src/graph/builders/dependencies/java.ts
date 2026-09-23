import { parentPath } from "@/graph/model/ids";
import type { ParsedImport } from "@/parser/types";
import { sharedPrefixLength, stripExtension } from "./paths";
import { compareTuples, sortStrings } from "../sort";
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
 * Java import resolution.
 *
 * Classes are indexed as `package + "." + FileName` from parse results
 * (`packageName`). Files that were not parsed are indexed from source roots
 * learned from parsed files, or from Maven/Gradle conventions (src/main/java).
 * Single-type imports resolve to the class file, "pkg.*" to every file of the
 * package (at most 20), and static / nested-class imports by progressively
 * shorter prefixes. JDK packages and anything unknown are external, named by
 * their first two segments ("java.util", "org.junit") — unless the import
 * lies in the repository's own organization/project packages, in which case it
 * is an unresolved internal reference (typically generated sources).
 */

const MAX_WILDCARD_TARGETS = 20;
const JDK_PREFIXES = ["java.", "javax.", "jdk.", "sun."];
const CONVENTIONAL_ROOT = /^(.*?\/)?src\/[A-Za-z0-9_-]+\/java\//;

function packageFromDirectory(directory: string): string | null {
  if (directory === "") return null;
  const segments = directory.split("/");
  return segments.every((segment) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(segment))
    ? segments.join(".")
    : null;
}

export function createJavaResolver(context: ResolverContext): LanguageResolver {
  const classIndex = new Map<string, string[]>();
  const packageIndex = new Map<string, string[]>();
  const learnedRoots = new Set<string>();
  const indexed = new Set<string>();

  const addClass = (fqcn: string, packageName: string, path: string): void => {
    const classes = classIndex.get(fqcn);
    if (classes) classes.push(path);
    else classIndex.set(fqcn, [path]);
    const files = packageIndex.get(packageName);
    if (files) files.push(path);
    else packageIndex.set(packageName, [path]);
    indexed.add(path);
  };

  for (const file of context.files) {
    if (file.parserLanguage !== "java" || !file.packageName) continue;
    const packageName = file.packageName.trim();
    if (!/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(packageName)) continue;
    const className = stripExtension(file.path.slice(file.path.lastIndexOf("/") + 1));
    addClass(`${packageName}.${className}`, packageName, file.path);
    const packagePath = packageName.split(".").join("/");
    const directory = parentPath(file.path);
    if (directory === packagePath) learnedRoots.add("");
    else if (directory.endsWith(`/${packagePath}`)) {
      learnedRoots.add(directory.slice(0, directory.length - packagePath.length - 1));
    }
  }

  const rootsByLength = [...learnedRoots].sort((a, b) => b.length - a.length);
  for (const path of sortStrings(context.allPaths)) {
    if (!path.endsWith(".java") || indexed.has(path)) continue;
    const learned = rootsByLength.find((root) => root === "" || path.startsWith(`${root}/`));
    let root: string | null = learned ?? null;
    if (root === null) {
      const match = CONVENTIONAL_ROOT.exec(path);
      if (match) root = match[0].slice(0, -1);
    }
    if (root === null) continue;
    const relativeDirectory = parentPath(root === "" ? path : path.slice(root.length + 1));
    const packageName = packageFromDirectory(relativeDirectory);
    if (!packageName) continue;
    const className = stripExtension(path.slice(path.lastIndexOf("/") + 1));
    addClass(`${packageName}.${className}`, packageName, path);
  }
  for (const list of [...classIndex.values(), ...packageIndex.values()]) list.sort();

  /**
   * Third package segments of repository code per organization prefix:
   * "com.acme.app" + "com.acme.util" -> "com.acme" => {"app", "util"}.
   * "" marks code declared directly in the organization package.
   */
  const projectsByOrganization = new Map<string, Set<string>>();
  for (const packageName of packageIndex.keys()) {
    const segments = packageName.split(".");
    if (segments.length < 2) continue;
    const organization = segments.slice(0, 2).join(".");
    const projects = projectsByOrganization.get(organization) ?? new Set<string>();
    projects.add(segments[2] ?? "");
    projectsByOrganization.set(organization, projects);
  }

  /**
   * Whether an unknown import most likely names repository code that is not in
   * the tree (generated sources). True when the repository owns the whole
   * organization prefix (several projects, or code directly in it) or the
   * import is in the same project. "com.google.myproject" code importing
   * "com.google.common..." (Guava) therefore stays external.
   */
  function looksInternal(segments: readonly string[]): boolean {
    const projects = projectsByOrganization.get(segments.slice(0, 2).join("."));
    if (!projects) return false;
    return projects.size > 1 || projects.has("") || projects.has(segments[2] ?? "");
  }

  /** Among same-named classes (multi-module builds), the one nearest the importer. */
  function nearest(paths: readonly string[], importer: string): string | null {
    let best: string | null = null;
    let bestKey: Array<number | string> = [];
    for (const path of paths) {
      const key = [-sharedPrefixLength(path, importer), path];
      if (best === null || compareTuples(key, bestKey) < 0) {
        best = path;
        bestKey = key;
      }
    }
    return best;
  }

  function lookupClass(segments: readonly string[], importer: string): string | null {
    for (let length = segments.length; length >= 2; length -= 1) {
      const paths = classIndex.get(segments.slice(0, length).join("."));
      if (paths) return nearest(paths, importer);
    }
    return null;
  }

  function externalOrUnresolved(segments: readonly string[], specifier: string): Resolution {
    if (JDK_PREFIXES.some((prefix) => specifier.startsWith(prefix))) {
      return external(segments.slice(0, 2).join("."));
    }
    if (segments.length < 2 || looksInternal(segments)) return UNRESOLVED;
    return external(segments.slice(0, 2).join("."));
  }

  function resolve(file: DependencyInputFile, imported: ParsedImport): Resolution {
    let specifier = imported.specifier
      .trim()
      .replace(/;$/, "")
      .replace(/^static\s+/, "")
      .trim();
    let wildcard = imported.names?.includes("*") ?? false;
    if (specifier.endsWith(".*")) {
      specifier = specifier.slice(0, -2);
      wildcard = true;
    }
    const segments = specifier.split(".").filter((segment) => segment !== "");
    if (segments.length === 0) return UNRESOLVED;

    if (wildcard) {
      const packageFiles = packageIndex.get(specifier);
      if (packageFiles) {
        // Graph files first so the edge cap never spends slots on files without buildings.
        const ordered = [
          ...packageFiles.filter((path) => context.graphPaths.has(path)),
          ...packageFiles.filter((path) => !context.graphPaths.has(path)),
        ];
        return internal(ordered.slice(0, MAX_WILDCARD_TARGETS));
      }
    }
    const hit = lookupClass(segments, file.path);
    if (hit) return internal([hit]);
    return externalOrUnresolved(segments, specifier);
  }

  return { resolve };
}
