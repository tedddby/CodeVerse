/**
 * Self-contained builder for hand-written or synthetic RepositoryGraph fixtures.
 *
 * Fixtures exist ONLY for tests, local rendering and development screenshots.
 * The real user flow always analyses real repository data.
 *
 * This builder deliberately does not reuse the production graph builders so the
 * visualization engine can be tested in isolation from the analysis pipeline.
 */
import {
  contributorIdFromLogin,
  dependencyEdgeId,
  directoryId,
  extensionOf,
  fileId,
  parentPath,
  baseName,
  ROOT_DIRECTORY_ID,
  symbolId,
} from "@/graph/model/ids";
import {
  GRAPH_SCHEMA_VERSION,
  type CommitNode,
  type ContributorNode,
  type DependencyEdge,
  type DirectoryNode,
  type ExternalPackage,
  type FileAnalysisStatus,
  type FileNode,
  type LanguageStat,
  type RepositoryGraph,
  type RepositoryInfo,
  type SymbolKind,
  type SymbolNode,
  type TimelineBucket,
} from "@/graph/model/types";
import {
  detectCategory,
  detectLanguage,
  isBinaryPath,
  isGeneratedPath,
  isParseableLanguage,
} from "@/lib/languages/registry";

export interface FixtureSymbolSpec {
  kind: SymbolKind;
  name: string;
  start: number;
  end: number;
  exported?: boolean;
  /** Name of the enclosing symbol declared earlier in the same file. */
  parent?: string;
}

export interface FixtureFileSpec {
  path: string;
  lines: number;
  /** Bytes; defaults to lines * 32. */
  size?: number;
  symbols?: FixtureSymbolSpec[];
  /** Internal imports are repository paths; external imports are prefixed with "pkg:". */
  imports?: string[];
  status?: FileAnalysisStatus;
}

export interface FixtureCommitSpec {
  sha: string;
  message: string;
  author: string;
  /** Days before the fixture reference date. */
  daysAgo: number;
  files: string[];
}

export interface FixtureSpec {
  owner: string;
  name: string;
  description?: string;
  stars?: number;
  forks?: number;
  /** Fixed reference date so fixtures are deterministic. */
  referenceDate: string;
  files: FixtureFileSpec[];
  commits?: FixtureCommitSpec[];
  contributors?: Array<{ login: string; name: string; contributions: number }>;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function buildFixtureGraph(spec: FixtureSpec): RepositoryGraph {
  const reference = Date.parse(spec.referenceDate);
  const repository: RepositoryInfo = {
    id: `fixture:${spec.owner}/${spec.name}`,
    provider: "fixture",
    owner: spec.owner,
    name: spec.name,
    fullName: `${spec.owner}/${spec.name}`,
    description: spec.description,
    url: `https://github.com/${spec.owner}/${spec.name}`,
    defaultBranch: "main",
    ref: "main",
    commitSha: "f1x7ure0000000000000000000000000000000001",
    stars: spec.stars ?? 0,
    forks: spec.forks ?? 0,
    language: "TypeScript",
    topics: [],
    createdAt: new Date(reference - 400 * DAY_MS).toISOString(),
    pushedAt: new Date(reference).toISOString(),
  };

  // ── Directories ──
  const directories = new Map<string, DirectoryNode>();
  const ensureDirectory = (path: string): DirectoryNode => {
    const existing = directories.get(path);
    if (existing) return existing;
    const parent = path === "" ? null : ensureDirectory(parentPath(path));
    const node: DirectoryNode = {
      id: path === "" ? ROOT_DIRECTORY_ID : directoryId(path),
      path,
      name: path === "" ? spec.name : baseName(path),
      parentId: parent ? parent.id : null,
      depth: path === "" ? 0 : path.split("/").length,
      childDirectoryIds: [],
      fileIds: [],
      stats: {
        fileCount: 0,
        directFileCount: 0,
        directDirectoryCount: 0,
        totalLines: 0,
        linesEstimated: false,
        totalBytes: 0,
        symbolCount: 0,
        omittedFileCount: 0,
        languageBytes: {},
      },
    };
    directories.set(path, node);
    if (parent) parent.childDirectoryIds.push(node.id);
    return node;
  };
  ensureDirectory("");

  // ── Files & symbols ──
  const sortedSpecs = [...spec.files].sort((a, b) => a.path.localeCompare(b.path));
  const files: FileNode[] = [];
  const symbols: SymbolNode[] = [];
  const filePaths = new Set(sortedSpecs.map((f) => f.path));
  const externalCounts = new Map<
    string,
    { importCount: number; files: Set<string>; language: string }
  >();
  const edgeWeights = new Map<string, DependencyEdge>();

  for (const fileSpec of sortedSpecs) {
    const dir = ensureDirectory(parentPath(fileSpec.path));
    const language = detectLanguage(fileSpec.path);
    const id = fileId(fileSpec.path);
    const binary = isBinaryPath(fileSpec.path);
    const status: FileAnalysisStatus =
      fileSpec.status ??
      (binary ? "binary" : isParseableLanguage(language.id) ? "parsed" : "content-only");

    const symbolIds: string[] = [];
    const idByName = new Map<string, string>();
    for (const s of fileSpec.symbols ?? []) {
      const sid = symbolId(fileSpec.path, s.name, s.start);
      idByName.set(s.name, sid);
      symbolIds.push(sid);
      symbols.push({
        id: sid,
        name: s.name,
        kind: s.kind,
        fileId: id,
        parentSymbolId: s.parent ? idByName.get(s.parent) : undefined,
        startLine: s.start,
        endLine: s.end,
        exported: s.exported ?? false,
        signature: `${s.kind} ${s.name}`,
      });
    }

    const imports = (fileSpec.imports ?? []).map((specifier, i) => {
      if (specifier.startsWith("pkg:")) {
        const name = specifier.slice(4);
        const entry = externalCounts.get(name) ?? {
          importCount: 0,
          files: new Set<string>(),
          language: language.id,
        };
        entry.importCount += 1;
        entry.files.add(id);
        externalCounts.set(name, entry);
        return { specifier: name, kind: "import" as const, line: i + 1, external: true };
      }
      if (!filePaths.has(specifier)) {
        throw new Error(
          `Fixture import "${specifier}" in ${fileSpec.path} does not match any fixture file`,
        );
      }
      const target = fileId(specifier);
      const edgeId = dependencyEdgeId("import", id, target);
      const existing = edgeWeights.get(edgeId);
      if (existing) existing.weight += 1;
      else edgeWeights.set(edgeId, { id: edgeId, source: id, target, kind: "import", weight: 1 });
      return {
        specifier: `./${specifier}`,
        kind: "import" as const,
        line: i + 1,
        resolvedFileId: target,
        external: false,
      };
    });

    const size = fileSpec.size ?? fileSpec.lines * 32;
    files.push({
      id,
      path: fileSpec.path,
      name: baseName(fileSpec.path),
      extension: extensionOf(baseName(fileSpec.path)),
      language: language.id,
      category: detectCategory(fileSpec.path, language),
      size,
      lines: binary ? 0 : fileSpec.lines,
      linesEstimated: status === "metadata-only",
      directoryId: dir.id,
      symbolIds,
      imports,
      exports: (fileSpec.symbols ?? []).filter((s) => s.exported).map((s) => s.name),
      status,
      statusReason: status === "metadata-only" ? "Fixture: content not analysed" : undefined,
      isGenerated: isGeneratedPath(fileSpec.path),
    });
    dir.fileIds.push(id);
  }

  // ── Contributors & commits ──
  const contributorSpecs = spec.contributors ?? [];
  const contributors = new Map<string, ContributorNode>();
  for (const c of contributorSpecs) {
    contributors.set(c.login, {
      id: contributorIdFromLogin(c.login),
      login: c.login,
      name: c.name,
      profileUrl: `https://github.com/${c.login}`,
      contributions: c.contributions,
      commitCount: 0,
      fileIds: [],
    });
  }

  const filesByPath = new Map(files.map((f) => [f.path, f] as const));
  const commits: CommitNode[] = (spec.commits ?? [])
    .map((c) => {
      const author = contributors.get(c.author);
      const date = new Date(reference - c.daysAgo * DAY_MS).toISOString();
      const fileIds = c.files.filter((p) => filesByPath.has(p)).map((p) => fileId(p));
      if (author) {
        author.commitCount += 1;
        for (const fid of fileIds) if (!author.fileIds.includes(fid)) author.fileIds.push(fid);
      }
      for (const path of c.files) {
        const file = filesByPath.get(path);
        if (!file) continue;
        const activity = file.activity ?? { commitCount: 0, contributorIds: [] };
        activity.commitCount += 1;
        if (!activity.lastModified || date > activity.lastModified) {
          activity.lastModified = date;
          activity.lastAuthorId = author?.id;
        }
        if (author && !activity.contributorIds.includes(author.id))
          activity.contributorIds.push(author.id);
        file.activity = activity;
      }
      return {
        sha: c.sha.padEnd(40, "0"),
        message: c.message,
        authorId: author?.id,
        authorName: author?.name ?? c.author,
        date,
        fileIds,
        changedFileCount: c.files.length,
        url: `https://github.com/${spec.owner}/${spec.name}/commit/${c.sha.padEnd(40, "0")}`,
      } satisfies CommitNode;
    })
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  // ── Directory stats (post-order) ──
  const dirList = [...directories.values()].sort(
    (a, b) => b.depth - a.depth || a.path.localeCompare(b.path),
  );
  const dirById = new Map(dirList.map((d) => [d.id, d] as const));
  const fileById = new Map(files.map((f) => [f.id, f] as const));
  for (const dir of dirList) {
    dir.childDirectoryIds.sort();
    dir.fileIds.sort();
    const stats = dir.stats;
    stats.directFileCount = dir.fileIds.length;
    stats.directDirectoryCount = dir.childDirectoryIds.length;
    for (const fid of dir.fileIds) {
      const file = fileById.get(fid);
      if (!file) continue;
      stats.fileCount += 1;
      stats.totalLines += file.lines;
      stats.totalBytes += file.size;
      stats.symbolCount += file.symbolIds.length;
      stats.linesEstimated ||= file.linesEstimated;
      stats.languageBytes[file.language] = (stats.languageBytes[file.language] ?? 0) + file.size;
    }
    for (const cid of dir.childDirectoryIds) {
      const child = dirById.get(cid);
      if (!child) continue;
      stats.fileCount += child.stats.fileCount;
      stats.totalLines += child.stats.totalLines;
      stats.totalBytes += child.stats.totalBytes;
      stats.symbolCount += child.stats.symbolCount;
      stats.linesEstimated ||= child.stats.linesEstimated;
      for (const [lang, bytes] of Object.entries(child.stats.languageBytes)) {
        stats.languageBytes[lang] = (stats.languageBytes[lang] ?? 0) + bytes;
      }
    }
  }

  // ── Languages ──
  const totalBytes = files.reduce((sum, f) => sum + f.size, 0) || 1;
  // Like production (and GitHub Linguist): generated, vendored and binary files don't count.
  const ownFiles = files.filter(
    (f) => !f.isGenerated && f.status !== "binary" && f.category !== "vendor",
  );
  const languageFiles = ownFiles.length > 0 ? ownFiles : files;
  const languageBytes = languageFiles.reduce((sum, f) => sum + f.size, 0) || 1;
  const languageMap = new Map<string, LanguageStat>();
  for (const file of languageFiles) {
    const info = detectLanguage(file.path);
    const stat =
      languageMap.get(info.id) ??
      ({
        id: info.id,
        name: info.name,
        color: info.color,
        files: 0,
        bytes: 0,
        lines: 0,
        share: 0,
        parseable: isParseableLanguage(info.id),
      } satisfies LanguageStat);
    stat.files += 1;
    stat.bytes += file.size;
    stat.lines += file.lines;
    languageMap.set(info.id, stat);
  }
  const languages = [...languageMap.values()]
    .map((l) => ({ ...l, share: l.bytes / languageBytes }))
    .sort((a, b) => b.bytes - a.bytes || a.id.localeCompare(b.id));

  // ── Timeline (weekly buckets over the commit range) ──
  const buckets: TimelineBucket[] = [];
  if (commits.length > 0) {
    const oldest = Date.parse(commits[commits.length - 1]?.date ?? spec.referenceDate);
    const start = oldest - (oldest % (7 * DAY_MS));
    for (let t = start; t <= reference; t += 7 * DAY_MS) {
      const end = t + 7 * DAY_MS;
      const count = commits.filter((c) => {
        const time = Date.parse(c.date);
        return time >= t && time < end;
      }).length;
      buckets.push({
        start: new Date(t).toISOString(),
        end: new Date(end).toISOString(),
        commits: count,
      });
    }
  }

  const dependencies = [...edgeWeights.values()].sort((a, b) => a.id.localeCompare(b.id));
  const externalPackages: ExternalPackage[] = [...externalCounts.entries()]
    .map(([name, v]) => ({
      name,
      importCount: v.importCount,
      fileCount: v.files.size,
      language: v.language,
    }))
    .sort((a, b) => b.importCount - a.importCount || a.name.localeCompare(b.name));

  const count = (status: FileAnalysisStatus) => files.filter((f) => f.status === status).length;
  const importsFound = files.reduce((sum, f) => sum + f.imports.length, 0);
  const externalImports = files.reduce(
    (sum, f) => sum + f.imports.filter((i) => i.external).length,
    0,
  );

  return {
    schemaVersion: GRAPH_SCHEMA_VERSION,
    repository,
    rootDirectoryId: ROOT_DIRECTORY_ID,
    directories: [...directories.values()].sort((a, b) => a.path.localeCompare(b.path)),
    files,
    symbols,
    dependencies,
    externalPackages,
    commits,
    contributors: [...contributors.values()].sort((a, b) => b.contributions - a.contributions),
    languages,
    timeline: {
      granularity: "week",
      coverage: "sampled",
      buckets,
      start: buckets[0]?.start,
      end: buckets[buckets.length - 1]?.end,
    },
    analysis: {
      tier: "full",
      generatedAt: spec.referenceDate,
      durationMs: 0,
      timings: {},
      coverage: {
        filesInRepository: files.length,
        filesInGraph: files.length,
        directoriesInRepository: directories.size,
        bytesInRepository: totalBytes,
        filesParsed: count("parsed"),
        filesPartial: count("partial"),
        filesContentOnly: count("content-only"),
        filesMetadataOnly: count("metadata-only"),
        filesBinary: count("binary"),
        filesFailed: count("failed"),
        bytesDownloaded: totalBytes,
        symbolsExtracted: symbols.length,
        importsFound,
        importsResolved: importsFound - externalImports,
        externalImports,
        unresolvedImports: 0,
      },
      treeTruncated: false,
      limits: {
        maxFiles: 25_000,
        maxParsedFiles: 1_500,
        maxFileBytes: 524_288,
        maxTotalBytes: 41_943_040,
        maxParseBytes: 262_144,
        maxCommits: 300,
        maxCommitDetails: 40,
        tierFullMax: 1_000,
        tierProgressiveMax: 10_000,
      },
      warnings: [],
      unsupportedLanguages: [],
      history: {
        commitsFetched: commits.length,
        commitsWithDetails: commits.length,
        filesWithActivity: files.filter((f) => f.activity?.lastModified).length,
        oldestCommitDate: commits[commits.length - 1]?.date,
        newestCommitDate: commits[0]?.date,
        perFileHistory: false,
      },
      cached: false,
      analyzerVersion: "fixture",
    },
  };
}

// ─── Synthetic generator (large repositories, LOD and performance testing) ──

/** Small, fast, deterministic PRNG. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SyntheticOptions {
  fileCount: number;
  seed?: number;
  /** Average files per directory. */
  filesPerDirectory?: number;
  /** Probability that a file imports another file. */
  importDensity?: number;
}

export function createSyntheticGraph(options: SyntheticOptions): RepositoryGraph {
  const random = mulberry32(options.seed ?? 42);
  const filesPerDirectory = options.filesPerDirectory ?? 12;
  const extensions = ["ts", "tsx", "js", "py", "go", "rs", "java", "md", "json", "css"];
  const words = [
    "core",
    "api",
    "auth",
    "ui",
    "data",
    "utils",
    "net",
    "io",
    "render",
    "server",
    "client",
    "store",
    "model",
    "view",
    "cli",
    "plugins",
    "compiler",
    "runtime",
    "shared",
    "tests",
  ];

  const directoriesList: string[] = [""];
  const files: FixtureFileSpec[] = [];
  let dirCursor = 0;
  for (let i = 0; i < options.fileCount; i += 1) {
    if (i > 0 && i % filesPerDirectory === 0) {
      const parent = directoriesList[Math.floor(random() * directoriesList.length)] ?? "";
      const depth = parent === "" ? 0 : parent.split("/").length;
      const name = `${words[Math.floor(random() * words.length)] ?? "dir"}${dirCursor}`;
      dirCursor += 1;
      directoriesList.push(depth >= 5 ? name : parent === "" ? name : `${parent}/${name}`);
    }
    const dir = directoriesList[directoriesList.length - 1] ?? "";
    const ext = extensions[Math.floor(random() * extensions.length)] ?? "ts";
    const lines = Math.max(5, Math.floor(Math.exp(random() * 7)));
    const path = dir === "" ? `file${i}.${ext}` : `${dir}/file${i}.${ext}`;
    const symbolCount = ext === "md" || ext === "json" ? 0 : Math.floor(random() * 8);
    const symbolsSpec: FixtureSymbolSpec[] = [];
    for (let s = 0; s < symbolCount; s += 1) {
      const start = Math.floor((s / Math.max(1, symbolCount)) * lines) + 1;
      symbolsSpec.push({
        kind: s % 3 === 0 ? "class" : "function",
        name: `sym${i}_${s}`,
        start,
        end: Math.min(lines, start + 5),
        exported: s % 2 === 0,
      });
    }
    files.push({ path, lines, symbols: symbolsSpec });
  }
  const density = options.importDensity ?? 0.6;
  for (const file of files) {
    if (random() < density && files.length > 1) {
      const target = files[Math.floor(random() * files.length)];
      if (target && target.path !== file.path) file.imports = [target.path];
    }
  }
  return buildFixtureGraph({
    owner: "synthetic",
    name: `repo-${options.fileCount}`,
    referenceDate: "2026-09-01T00:00:00.000Z",
    files,
  });
}
