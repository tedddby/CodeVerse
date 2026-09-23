/**
 * Test-only assertions shared by the assembly tests. Not imported by production code.
 */
import { expect } from "vitest";
import { buildGraphIndex } from "@/graph/model/graph-index";
import type { RepositoryGraph } from "@/graph/model/types";
import { isBinaryPath } from "@/lib/languages/registry";

/** Asserts every cross-reference and aggregate in a graph is consistent. */
export function expectConsistent(graph: RepositoryGraph): void {
  const index = buildGraphIndex(graph);
  expect(index.directoriesById.has(graph.rootDirectoryId)).toBe(true);
  for (const directory of graph.directories) {
    if (directory.parentId !== null) {
      expect(index.directoriesById.get(directory.parentId)?.childDirectoryIds).toContain(
        directory.id,
      );
    }
    for (const child of directory.childDirectoryIds)
      expect(index.directoriesById.get(child)?.parentId).toBe(directory.id);
    for (const id of directory.fileIds)
      expect(index.filesById.get(id)?.directoryId).toBe(directory.id);
    expect(directory.childDirectoryIds).toEqual([...directory.childDirectoryIds].sort());
    expect(directory.fileIds).toEqual([...directory.fileIds].sort());
    const children = directory.childDirectoryIds.map((id) => index.directoriesById.get(id)?.stats);
    const sum = (pick: (stats: NonNullable<(typeof children)[number]>) => number) =>
      children.reduce((total, stats) => total + (stats ? pick(stats) : 0), 0);
    expect(directory.stats.fileCount).toBe(
      directory.stats.directFileCount + sum((stats) => stats.fileCount),
    );
    expect(directory.stats.directDirectoryCount).toBe(directory.childDirectoryIds.length);
  }
  for (const file of graph.files) {
    expect(index.directoriesById.get(file.directoryId)?.fileIds).toContain(file.id);
    for (const symbolId of file.symbolIds)
      expect(index.symbolsById.get(symbolId)?.fileId).toBe(file.id);
    for (const ref of file.imports)
      if (ref.resolvedFileId) expect(index.filesById.has(ref.resolvedFileId)).toBe(true);
    if (file.activity) {
      for (const id of file.activity.contributorIds)
        expect(index.contributorsById.has(id)).toBe(true);
      if (file.activity.lastAuthorId)
        expect(index.contributorsById.has(file.activity.lastAuthorId)).toBe(true);
    }
  }
  for (const symbol of graph.symbols) {
    if (symbol.parentSymbolId)
      expect(index.symbolsById.get(symbol.parentSymbolId)?.fileId).toBe(symbol.fileId);
  }
  expect(new Set(graph.symbols.map((symbol) => symbol.id)).size).toBe(graph.symbols.length);
  for (const edge of graph.dependencies) {
    expect(index.filesById.has(edge.source)).toBe(true);
    expect(index.filesById.has(edge.target)).toBe(true);
    expect(edge.source).not.toBe(edge.target);
  }
  for (const commit of graph.commits) {
    if (commit.authorId) expect(index.contributorsById.has(commit.authorId)).toBe(true);
    for (const id of commit.fileIds ?? []) expect(index.filesById.has(id)).toBe(true);
  }
  for (const contributor of graph.contributors) {
    for (const id of contributor.fileIds) expect(index.filesById.has(id)).toBe(true);
  }

  const { coverage } = graph.analysis;
  const root = index.directoriesById.get(graph.rootDirectoryId);
  expect(root?.stats.fileCount).toBe(coverage.filesInRepository);
  expect(root?.stats.totalBytes).toBe(coverage.bytesInRepository);
  expect(root?.stats.symbolCount).toBe(graph.symbols.length);
  expect(root?.stats.omittedFileCount).toBe(coverage.filesInRepository - coverage.filesInGraph);
  expect(coverage.filesInGraph).toBe(graph.files.length);
  expect(coverage.directoriesInRepository).toBe(graph.directories.length);
  expect(
    coverage.filesParsed +
      coverage.filesPartial +
      coverage.filesContentOnly +
      coverage.filesMetadataOnly +
      coverage.filesBinary +
      coverage.filesFailed,
  ).toBe(coverage.filesInGraph);
  expect(coverage.symbolsExtracted).toBe(graph.symbols.length);
  expect(coverage.importsFound).toBe(
    graph.files.reduce((sum, file) => sum + file.imports.length, 0),
  );
  expect(coverage.importsFound).toBe(
    coverage.importsResolved + coverage.externalImports + coverage.unresolvedImports,
  );
  // Languages follow Linguist: generated, vendored and binary files do not count
  // (unless the repository has nothing else).
  const languageFiles = graph.languages.reduce((sum, language) => sum + language.files, 0);
  expect(languageFiles).toBeLessThanOrEqual(coverage.filesInRepository);
  expect(graph.languages.reduce((sum, language) => sum + language.lines, 0)).toBeLessThanOrEqual(
    root?.stats.totalLines ?? 0,
  );
  if (coverage.filesInGraph === coverage.filesInRepository && graph.files.length > 0) {
    const own = graph.files.filter(
      (file) => !file.isGenerated && !isBinaryPath(file.path) && file.category !== "vendor",
    );
    expect(languageFiles).toBe(own.length > 0 ? own.length : graph.files.length);
  }
}
