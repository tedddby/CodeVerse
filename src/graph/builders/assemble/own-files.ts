import type { InventoryFile } from "../inventory";

/**
 * The repository's "own" files. Like GitHub Linguist, lockfiles, bundles,
 * vendored code and binaries do not describe what a repository is written in
 * or how much code it has: language statistics and directory line totals
 * leave them out.
 */
export function isOwnFile(file: InventoryFile): boolean {
  return !file.isGenerated && !file.isBinary && file.category !== "vendor";
}
