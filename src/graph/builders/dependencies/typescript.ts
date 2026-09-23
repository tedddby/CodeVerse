import { parentPath } from "@/graph/model/ids";
import type { ParsedImport } from "@/parser/types";
import {
  collectWorkspacePackages,
  probeModule,
  readManifests,
  resolvePackageEntry,
  subpathTargets,
} from "./js-packages";
import {
  nodeBuiltinName,
  packageNameOf,
  packageSubpathOf,
  protocolExternalName,
} from "./npm-names";
import { ancestorDirectories, joinPath } from "./paths";
import { TsConfigIndex, matchPathAliases } from "./tsconfig";
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
 * TypeScript / JavaScript import resolution, in the order TypeScript and Node
 * would apply it:
 *
 * 1. relative ("./x", "../x") and root-relative ("/x") specifiers, with probing
 * 2. "node:" builtins and protocol specifiers (npm:, jsr:, https:, virtual:)
 * 3. tsconfig/jsconfig "paths" of the importer's nearest config
 * 4. "#subpath" imports from the nearest package.json "imports" field
 * 5. tsconfig "baseUrl"
 * 6. Node core modules without prefix ("fs", "path")
 * 7. workspace packages (any package.json "name" in the repository)
 * 8. otherwise an external npm package; alias-like specifiers ("@/x", "~/x")
 *    that match nothing are unresolved.
 */

/** Removes bundler query strings and inline loader prefixes ("raw-loader!./a.txt?raw"). */
function cleanSpecifier(specifier: string): string {
  let cleaned = specifier.trim();
  const bang = cleaned.lastIndexOf("!");
  if (bang !== -1) cleaned = cleaned.slice(bang + 1);
  const query = cleaned.indexOf("?");
  if (query !== -1) cleaned = cleaned.slice(0, query);
  return cleaned;
}

function isRelative(specifier: string): boolean {
  return (
    specifier === "." ||
    specifier === ".." ||
    specifier.startsWith("./") ||
    specifier.startsWith("../")
  );
}

export function createTypeScriptResolver(context: ResolverContext): LanguageResolver {
  const manifests = readManifests(context.configFiles);
  const packages = collectWorkspacePackages(manifests);
  const tsconfigs = new TsConfigIndex(context.configFiles, packages);
  const probe = (candidate: string | null): string | null =>
    candidate === null ? null : probeModule(context.allPaths, candidate);
  const found = (path: string | null): Resolution =>
    path === null ? UNRESOLVED : internal([path]);

  /** "#internal/x" -> nearest package.json "imports" map. */
  function resolveSubpathImport(importer: string, specifier: string): Resolution {
    const directory = ancestorDirectories(importer).find((candidate) => manifests.has(candidate));
    if (directory === undefined) return UNRESOLVED;
    const imports = manifests.get(directory)?.imports;
    for (const target of subpathTargets(imports, specifier)) {
      if (target.startsWith("./")) {
        const hit = probe(joinPath(directory, target));
        if (hit !== null) return internal([hit]);
      } else {
        const name = packageNameOf(target);
        if (name) return external(nodeBuiltinName(target) ?? name);
      }
    }
    return UNRESOLVED;
  }

  function resolve(file: DependencyInputFile, imported: ParsedImport): Resolution {
    const specifier = cleanSpecifier(imported.specifier);
    if (specifier === "") return UNRESOLVED;
    if (isRelative(specifier)) return found(probe(joinPath(parentPath(file.path), specifier)));
    if (specifier.startsWith("/")) return found(probe(joinPath("", specifier)));
    if (specifier.startsWith("node:")) {
      const builtin = nodeBuiltinName(specifier);
      return builtin ? external(builtin) : UNRESOLVED;
    }
    const protocol = protocolExternalName(specifier);
    if (protocol !== null) return external(protocol);

    const config = tsconfigs.forFile(file.path);
    if (config) {
      for (const target of matchPathAliases(config.aliases, specifier)) {
        const hit = probe(joinPath(config.pathsBase, target));
        if (hit !== null) return internal([hit]);
      }
    }
    if (specifier.startsWith("#")) return resolveSubpathImport(file.path, specifier);
    if (config?.baseUrl != null) {
      const hit = probe(joinPath(config.baseUrl, specifier));
      if (hit !== null) return internal([hit]);
    }

    const builtin = nodeBuiltinName(specifier);
    if (builtin) return external(builtin);
    const name = packageNameOf(specifier);
    if (name === null) return UNRESOLVED;
    const workspacePackage = packages.get(name);
    if (workspacePackage) {
      return found(resolvePackageEntry(workspacePackage, packageSubpathOf(specifier, name), probe));
    }
    return external(name);
  }

  return { resolve };
}
