import { baseName, parentPath } from "@/graph/model/ids";
import type { ParsedImport } from "@/parser/types";
import { joinPath } from "./paths";
import { compareStrings } from "../sort";
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
 * Go import resolution.
 *
 * Every go.mod declares a module path rooted at its directory; local `replace`
 * directives add more. An import path resolves by the longest matching module
 * path to a directory, and a Go import depends on every non-test file of that
 * package (edges capped at 10, representative first). Standard library paths
 * (first segment without a dot) are external with their full path ("net/http").
 * Third-party imports are external, named by the module that go.mod requires
 * when known, else by host conventions ("github.com/x/y", "golang.org/x/net",
 * "go.uber.org/zap").
 */

const MAX_PACKAGE_TARGETS = 10;
/** Hosts whose module paths are host/owner/repo. */
const THREE_SEGMENT_HOSTS: ReadonlySet<string> = new Set([
  "github.com",
  "gitlab.com",
  "bitbucket.org",
  "gitee.com",
  "codeberg.org",
  "git.sr.ht",
]);

interface GoModule {
  path: string;
  root: string;
}

export interface GoModFile {
  module: string | null;
  requires: string[];
  /** Local replacements: module path -> relative directory. */
  replaces: Array<{ path: string; directory: string }>;
}

function unquote(value: string): string {
  return value.replace(/^["`]|["`]$/g, "");
}

/** Parses the parts of a go.mod file that matter for resolution. Never throws. */
export function parseGoMod(content: string): GoModFile {
  const result: GoModFile = { module: null, requires: [], replaces: [] };
  let block: string | null = null;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.replace(/\/\/.*$/, "").trim();
    if (line === "") continue;
    if (block !== null) {
      if (line === ")") {
        block = null;
        continue;
      }
      handleDirective(result, block, line);
      continue;
    }
    const match = /^(module|require|replace)\s*(.*)$/.exec(line);
    if (!match) continue;
    const directive = match[1] ?? "";
    const rest = (match[2] ?? "").trim();
    if (rest === "(") block = directive;
    else handleDirective(result, directive, rest);
  }
  return result;
}

function handleDirective(result: GoModFile, directive: string, line: string): void {
  const fields = line.split(/\s+/).map(unquote);
  if (directive === "module" && fields[0]) result.module = fields[0];
  else if (directive === "require" && fields[0]) result.requires.push(fields[0]);
  else if (directive === "replace") {
    const arrow = fields.indexOf("=>");
    const from = fields[0];
    const target = fields[arrow + 1];
    if (arrow > 0 && from && target && (target.startsWith("./") || target.startsWith("../"))) {
      result.replaces.push({ path: from, directory: target });
    }
  }
}

/** Module-ish name of a third-party import path when go.mod does not say. */
function externalModuleName(importPath: string): string {
  const segments = importPath.split("/");
  const host = segments[0] ?? importPath;
  let length =
    THREE_SEGMENT_HOSTS.has(host) || (host === "golang.org" && segments[1] === "x") ? 3 : 2;
  if (/^v\d+$/.test(segments[length] ?? "")) length += 1;
  return segments.slice(0, length).join("/");
}

function matchesModule(importPath: string, modulePath: string): boolean {
  return importPath === modulePath || importPath.startsWith(`${modulePath}/`);
}

export function createGoResolver(context: ResolverContext): LanguageResolver {
  const modules: GoModule[] = [];
  const requires = new Set<string>();
  for (const [path, content] of [...context.configFiles].sort(([a], [b]) => compareStrings(a, b))) {
    if (baseName(path) !== "go.mod") continue;
    const directory = parentPath(path);
    const parsed = parseGoMod(content);
    if (parsed.module) modules.push({ path: parsed.module, root: directory });
    for (const required of parsed.requires) requires.add(required);
    for (const replacement of parsed.replaces) {
      const root = joinPath(directory, replacement.directory);
      if (root !== null) modules.push({ path: replacement.path, root });
    }
  }
  // Longest module path first; the first declaration wins ties (stable sort).
  modules.sort((a, b) => b.path.length - a.path.length);
  const requiredByLength = [...requires].sort(
    (a, b) => b.length - a.length || compareStrings(a, b),
  );

  /** Non-test .go files of a package directory, representative first (dir-named file or doc.go). */
  function packageFiles(directory: string): string[] {
    const files = (context.filesByDirectory.get(directory) ?? []).filter(
      (path) => path.endsWith(".go") && !path.endsWith("_test.go"),
    );
    const representative = [`${baseName(directory)}.go`, "doc.go"]
      .map((name) => files.find((path) => baseName(path) === name))
      .find((path) => path !== undefined);
    return representative
      ? [representative, ...files.filter((path) => path !== representative)]
      : files;
  }

  function resolve(_file: DependencyInputFile, imported: ParsedImport): Resolution {
    const importPath = unquote(imported.specifier.trim());
    if (importPath === "") return UNRESOLVED;
    if (importPath === "C") return external("C");

    const goModule = modules.find((candidate) => matchesModule(importPath, candidate.path));
    if (goModule) {
      const subdirectory = importPath.slice(goModule.path.length).replace(/^\/+/, "");
      const directory = joinPath(goModule.root, subdirectory);
      if (directory === null) return UNRESOLVED;
      const files = packageFiles(directory);
      const inGraph = files.filter((path) => context.graphPaths.has(path));
      // Edges only reach graph files; files outside the graph still make the import "resolved".
      return internal(
        inGraph.length > 0 ? inGraph.slice(0, MAX_PACKAGE_TARGETS) : files.slice(0, 1),
      );
    }

    const first = importPath.split("/")[0] ?? "";
    if (!first.includes(".")) return external(importPath);
    const required = requiredByLength.find((candidate) => matchesModule(importPath, candidate));
    return external(required ?? externalModuleName(importPath));
  }

  return { resolve };
}
