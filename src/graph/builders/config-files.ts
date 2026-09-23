import { baseName } from "@/graph/model/ids";

/**
 * Manifests and compiler configs that drive cross-file dependency resolution:
 * workspace packages (package.json), path aliases (tsconfig/jsconfig), Go module
 * paths (go.mod), Rust crates (Cargo.toml) and Python source roots.
 */
const RESOLUTION_CONFIG_NAMES: ReadonlySet<string> = new Set([
  "package.json",
  "jsconfig.json",
  "go.mod",
  "Cargo.toml",
  "pyproject.toml",
  "setup.cfg",
  "setup.py",
]);

/** Whether a path is a config file the dependency resolvers read (see `resolveDependencies`). */
export function isResolutionConfigFile(path: string): boolean {
  const name = baseName(path);
  if (RESOLUTION_CONFIG_NAMES.has(name)) return true;
  return /^tsconfig(\.[^/]*)?\.json$/.test(name);
}
