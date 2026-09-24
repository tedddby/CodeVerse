import type { FileNode, LanguageStat } from "@/graph/model/types";
import { getLanguage, isParseableLanguage } from "@/lib/languages/registry";
import type { InventoryFile } from "../inventory";
import { compareTuples } from "../sort";
import { linesContribution } from "./directories";
import { isOwnFile } from "./own-files";

/**
 * Language statistics over the repository's own files (omitted files included,
 * with size-based line estimates). Like GitHub Linguist, generated, vendored
 * and binary files are excluded — unless the repository contains nothing else.
 * Shares are relative to the counted bytes. Sorted by bytes, "unknown" last.
 */
export function buildLanguageStats(
  inventoryFiles: readonly InventoryFile[],
  graphFiles: ReadonlyMap<string, FileNode>,
): LanguageStat[] {
  const ownFiles = inventoryFiles.filter(isOwnFile);
  const counted = ownFiles.length > 0 ? ownFiles : inventoryFiles;
  const totalBytes = counted.reduce((sum, file) => sum + file.size, 0);
  const stats = new Map<string, LanguageStat>();
  for (const file of counted) {
    let stat = stats.get(file.language);
    if (!stat) {
      const info = getLanguage(file.language);
      stat = {
        id: info.id,
        name: info.name,
        color: info.color,
        files: 0,
        bytes: 0,
        lines: 0,
        share: 0,
        parseable: isParseableLanguage(info.id),
      };
      stats.set(file.language, stat);
    }
    stat.files += 1;
    stat.bytes += file.size;
    stat.lines += linesContribution(file, graphFiles.get(file.path)).lines;
  }
  for (const stat of stats.values()) stat.share = totalBytes > 0 ? stat.bytes / totalBytes : 0;
  return [...stats.values()].sort((a, b) =>
    compareTuples(
      [a.id === "unknown" ? 1 : 0, -a.bytes, -a.files, a.id],
      [b.id === "unknown" ? 1 : 0, -b.bytes, -b.files, b.id],
    ),
  );
}
