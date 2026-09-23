import { parentPath } from "@/graph/model/ids";
import { isJsonObject, parseJsonc } from "./jsonc";
import type { WorkspacePackage } from "./js-packages";
import { packageNameOf, packageSubpathOf } from "./npm-names";
import { joinPath } from "./paths";

/**
 * tsconfig.json / jsconfig.json handling: nearest config lookup, relative and
 * workspace-package "extends" chains (depth <= 5), baseUrl and "paths" aliases.
 *
 * Semantics follow TypeScript: "baseUrl" is relative to the config that
 * declares it; "paths" targets are relative to the effective baseUrl, or to the
 * config that declares "paths" when there is no baseUrl. Solution-style configs
 * ("files": [] + "references") delegate to the first referenced config with
 * aliases.
 */

interface PathAlias {
  pattern: string;
  prefix: string;
  suffix: string;
  wildcard: boolean;
  targets: string[];
}

export interface EffectiveTsConfig {
  /** Repository path of the effective baseUrl, or null. */
  baseUrl: string | null;
  aliases: PathAlias[];
  /** Directory "paths" targets are resolved against. */
  pathsBase: string;
}

interface LoadedConfig {
  baseUrl?: string;
  paths?: { mapping: PathAlias[]; definedIn: string };
  references: string[];
}

const MAX_EXTENDS_DEPTH = 5;

function parsePathAliases(value: unknown): PathAlias[] {
  if (!isJsonObject(value)) return [];
  const aliases: PathAlias[] = [];
  for (const [pattern, rawTargets] of Object.entries(value)) {
    const star = pattern.indexOf("*");
    if (star !== pattern.lastIndexOf("*")) continue;
    const targets = (Array.isArray(rawTargets) ? rawTargets : [rawTargets]).filter(
      (target): target is string => typeof target === "string" && target !== "",
    );
    if (targets.length === 0) continue;
    aliases.push({
      pattern,
      prefix: star === -1 ? pattern : pattern.slice(0, star),
      suffix: star === -1 ? "" : pattern.slice(star + 1),
      wildcard: star !== -1,
      targets,
    });
  }
  return aliases;
}

/** Candidate targets (relative to `pathsBase`) for a specifier, per TypeScript's matching rules. */
export function matchPathAliases(aliases: readonly PathAlias[], specifier: string): string[] {
  const exact = aliases.find((alias) => !alias.wildcard && alias.pattern === specifier);
  if (exact) return exact.targets;
  let best: PathAlias | null = null;
  for (const alias of aliases) {
    if (
      alias.wildcard &&
      specifier.length >= alias.prefix.length + alias.suffix.length &&
      specifier.startsWith(alias.prefix) &&
      specifier.endsWith(alias.suffix) &&
      (!best || alias.prefix.length > best.prefix.length)
    ) {
      best = alias;
    }
  }
  if (!best) return [];
  const matched = specifier.slice(best.prefix.length, specifier.length - best.suffix.length);
  return best.targets.map((target) => target.replace("*", matched));
}

export class TsConfigIndex {
  private readonly loaded = new Map<string, LoadedConfig | null>();
  private readonly nearest = new Map<string, EffectiveTsConfig | null>();

  constructor(
    private readonly configFiles: ReadonlyMap<string, string>,
    private readonly packages: ReadonlyMap<string, WorkspacePackage>,
  ) {}

  /** Effective aliases for a source file: its nearest tsconfig.json/jsconfig.json. */
  forFile(path: string): EffectiveTsConfig | null {
    return this.forDirectory(parentPath(path));
  }

  private forDirectory(directory: string): EffectiveTsConfig | null {
    const cached = this.nearest.get(directory);
    if (cached !== undefined) return cached;
    const prefix = directory === "" ? "" : `${directory}/`;
    let result: EffectiveTsConfig | null = null;
    const own = [`${prefix}tsconfig.json`, `${prefix}jsconfig.json`].find((path) =>
      this.configFiles.has(path),
    );
    if (own) result = this.effective(own);
    else if (directory !== "") result = this.forDirectory(parentPath(directory));
    else if (this.configFiles.has("tsconfig.base.json"))
      result = this.effective("tsconfig.base.json");
    this.nearest.set(directory, result);
    return result;
  }

  private effective(path: string): EffectiveTsConfig | null {
    let config = this.load(path, 0, new Set());
    if (config && config.paths === undefined && config.baseUrl === undefined) {
      const referenced = config.references
        .map((reference) => this.load(reference, 0, new Set()))
        .find((candidate) => candidate && (candidate.paths || candidate.baseUrl !== undefined));
      if (referenced) config = referenced;
    }
    if (!config || (config.paths === undefined && config.baseUrl === undefined)) return null;
    const baseUrl = config.baseUrl ?? null;
    return {
      baseUrl,
      aliases: config.paths?.mapping ?? [],
      pathsBase: baseUrl ?? config.paths?.definedIn ?? "",
    };
  }

  private resolveExtends(directory: string, reference: string): string | null {
    let base: string | null = null;
    if (reference.startsWith(".") || reference.startsWith("/")) {
      base = joinPath(directory, reference);
    } else {
      const name = packageNameOf(reference);
      const pkg = name ? this.packages.get(name) : undefined;
      if (name && pkg) {
        const subpath = packageSubpathOf(reference, name);
        base = joinPath(pkg.directory, subpath === "" ? "tsconfig.json" : subpath);
      }
    }
    if (base === null) return null;
    const nested = base === "" ? "tsconfig.json" : `${base}/tsconfig.json`;
    return [base, `${base}.json`, nested].find((path) => this.configFiles.has(path)) ?? null;
  }

  private load(path: string, depth: number, visiting: ReadonlySet<string>): LoadedConfig | null {
    const cached = this.loaded.get(path);
    if (cached !== undefined) return cached;
    const content = this.configFiles.get(path);
    if (content === undefined) return null;
    const parsed = parseJsonc(content);
    const json = isJsonObject(parsed) ? parsed : {};
    const directory = parentPath(path);
    const config: LoadedConfig = { references: [] };

    const extendsField = json.extends;
    const parents =
      typeof extendsField === "string"
        ? [extendsField]
        : Array.isArray(extendsField)
          ? extendsField
          : [];
    if (depth < MAX_EXTENDS_DEPTH) {
      const chain = new Set(visiting).add(path);
      for (const reference of parents) {
        if (typeof reference !== "string") continue;
        const parentConfigPath = this.resolveExtends(directory, reference);
        if (!parentConfigPath || chain.has(parentConfigPath)) continue;
        const parent = this.load(parentConfigPath, depth + 1, chain);
        if (parent?.baseUrl !== undefined) config.baseUrl = parent.baseUrl;
        if (parent?.paths) config.paths = parent.paths;
      }
    }

    const options = json.compilerOptions;
    if (isJsonObject(options)) {
      if (typeof options.baseUrl === "string") {
        const baseUrl = joinPath(directory, options.baseUrl);
        if (baseUrl !== null) config.baseUrl = baseUrl;
      }
      if (isJsonObject(options.paths)) {
        config.paths = { mapping: parsePathAliases(options.paths), definedIn: directory };
      }
    }

    if (Array.isArray(json.references)) {
      for (const reference of json.references) {
        if (!isJsonObject(reference) || typeof reference.path !== "string") continue;
        const target = joinPath(directory, reference.path);
        if (target === null) continue;
        config.references.push(
          target.endsWith(".json")
            ? target
            : target === ""
              ? "tsconfig.json"
              : `${target}/tsconfig.json`,
        );
      }
    }

    this.loaded.set(path, config);
    return config;
  }
}
