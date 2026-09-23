# CodeVerse architecture

This document explains how a GitHub URL becomes a 3D city: the module boundaries, the data model that
connects them, the streaming protocol, caching, the layout algorithm, rendering, and how to extend the
system with new languages and repository sources.

![CodeVerse analysis pipeline](architecture.svg)

## Design principles

1. **Repository data is untrusted.** Paths, names, file contents, commit messages and descriptions come from
   strangers. They are validated at the boundary, parsed as data, rendered as text and never executed.
2. **One normalized model.** Everything downstream of ingestion consumes a provider-agnostic
   `RepositoryGraph`. The renderer never talks to GitHub and never branches on where a graph came from.
3. **Determinism.** The same repository at the same commit yields the same ids, the same graph (byte-identical
   JSON) and the same layout. That makes caching, share links and tests reliable.
4. **Honesty over completeness.** Limits are explicit. Every file carries an analysis status, estimates are
   flagged, and the analysis report lists what was skipped and why.
5. **One channel between UI and canvas.** React panels and the three.js scene communicate only through the
   Zustand explorer store; nothing is prop-drilled across the canvas boundary.

## Module boundaries

| Module                                         | Responsibility                                                                                                                                                  | May depend on                        |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `src/lib/validation`                           | Parse user input into `owner/repo[@ref]`; the SSRF boundary (only `github.com` repositories)                                                                    | –                                    |
| `src/github`                                   | HTTP client for the GitHub REST and GraphQL APIs: Zod validation, retries, rate limits, ETags, path sanitization                                                | `lib`                                |
| `src/sources`                                  | `RepositorySource` provider interface ([types](../src/sources/types.ts)); GitHub and in-memory providers                                                        | `github`, `graph/model`, `lib`       |
| `src/parser`                                   | tree-sitter runtime, grammar loaders, one `LanguageModule` per language; never throws                                                                           | `lib/languages`                      |
| `src/graph/model`                              | The `RepositoryGraph` types, stable id helpers and `buildGraphIndex()`                                                                                          | –                                    |
| `src/graph/builders`                           | Inventory, file selection, fetch planning, dependency resolution, history and final assembly                                                                    | `graph/model`, `parser` types, `lib` |
| `src/analysis`                                 | Analysis service: pipeline stages, graph cache lookups, in-flight sharing; plus the wire contracts shared with the client (`protocol.ts`, `source-protocol.ts`) | `sources`, `parser`, `graph`, `lib`  |
| `src/lib/cache`, `rate-limit`, `observability` | Tiered caches, per-client token buckets, structured logs with secret redaction, metrics facade                                                                  | –                                    |
| `src/app/api/*`                                | Route handlers: analyze (stream), source (file content on demand), repo (summary), health                                                                       | everything server-side               |
| `src/lib/analysis-client`                      | Browser side of the stream: incremental NDJSON reader and a state machine hook                                                                                  | `analysis`, `state`                  |
| `src/state`                                    | Zustand explorer store: graph, index, layout, selection, modes, panels, camera commands                                                                         | `graph/model`, `engine/layout` types |
| `src/engine/layout`                            | Deterministic city layout (pure; runs in a Web Worker via `src/workers`)                                                                                        | `graph/model`                        |
| `src/engine/rendering`, `lod`, `camera`        | three.js scene, instancing, level of detail, camera rig                                                                                                         | `state`, `engine/layout`             |
| `src/components`                               | Explorer shell, panels, search, timeline, code viewer, landing page, shared UI kit                                                                              | `state`, `lib`, `analysis`           |

The parser and layout engine import no Node built-ins, so they run on the server, in the browser and in workers.
Server-only modules (token handling, file-system cache, grammar loading from disk) are only imported by route
handlers and server components.

## Request lifecycle

1. The landing page validates the input with `parseRepositoryInput()` and navigates to
   `/explore/{owner}/{repo}` (plus `?ref=` when the URL pointed at a branch, tag or commit).
2. The explore page (a server component) validates the route parameters, adds repository metadata for social
   previews (with a short timeout, so GitHub can never delay the page) and renders the client explorer.
3. `useRepositoryAnalysis` opens `GET /api/analyze/{owner}/{repo}?ref=...` and reads the NDJSON stream.
4. The route handler resolves the ref to an exact commit, checks the graph cache, and otherwise runs the
   pipeline stages below, emitting progress events as it goes.
5. A structure-only **preview** graph arrives as soon as the file tree is known; the city renders dimmed
   behind the loading screen while parsing continues. The **complete** graph replaces it.
6. Every graph goes through `loadGraph()` in the store, which builds the index. `useLayoutEngine` computes the
   layout in a worker and publishes it; the renderer, minimap and panels react to the store.
7. Opening a file calls `GET /api/source/{owner}/{repo}?ref={commitSha}&path=...` (lazy, per file).

### Pipeline stages

The stage ids are shared with the loading UI (`ANALYSIS_STAGES` in [protocol.ts](../src/analysis/protocol.ts)):

| Stage          | What happens                                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------------------------- |
| `connect`      | Validate `owner/repo`, fetch repository metadata, resolve the ref to a commit SHA, check the cache                  |
| `tree`         | List the recursive file tree; sanitize paths; drop submodules and symlinks; detect truncation                       |
| `languages`    | Detect language, category (source, test, docs, ...), binary and generated files for every path                      |
| `fetch`        | Choose the analysis tier, select which files become buildings and which get downloaded, download with a byte budget |
| `parse`        | Parse eligible files with tree-sitter: symbols, imports, exports, package names; per-file timeouts                  |
| `dependencies` | Resolve imports per language into file-to-file edges and external packages                                          |
| `history`      | Recent commits, changed files for a subset, contributors; with a token, per-file activity and exact commit counts   |
| `construct`    | Assemble, validate and cache the `RepositoryGraph`                                                                  |

Stages degrade instead of failing. Each has a share of the overall time budget (110 s): past it, no new
downloads or parses are started and optional history steps are skipped, and the report says so. Only a run
that overshoots the budget by a grace period is aborted with a `TIMEOUT` error.

## The RepositoryGraph

Defined in [src/graph/model/types.ts](../src/graph/model/types.ts). Collections are plain arrays (JSON-friendly);
`buildGraphIndex()` derives O(1) lookup maps once per graph.

| Part                                  | Contents                                                                                                                    |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `repository`                          | Provider, owner/name, analyzed `ref` and exact `commitSha`, stars, topics, license                                          |
| `directories`                         | Tree of `DirectoryNode`s with recursive stats (files, lines, bytes, symbols, omitted files, language bytes)                 |
| `files`                               | `FileNode`s: language, category, size, lines (flagged when estimated), symbols, imports, exports, analysis status, activity |
| `symbols`                             | `SymbolNode`s: kind, line range, parent symbol, exported flag, one-line signature (≤ 160 characters)                        |
| `dependencies`                        | `DependencyEdge`s (`source` imports `target`), weighted by the number of import statements                                  |
| `externalPackages`                    | Third-party packages and standard-library modules with import and file counts                                               |
| `commits`, `contributors`, `timeline` | Analyzed history; the timeline says whether it is `full-history` or `sampled`                                               |
| `languages`                           | Byte, file and line shares per language, and whether each is parseable                                                      |
| `analysis`                            | Tier, timings, coverage counters, the limits used, warnings, unsupported languages, rate limit, cache flag                  |

**Ids** are derived from paths ([ids.ts](../src/graph/model/ids.ts)): `dir:<path>`, `file:<path>`,
`sym:<path>#<name>@<line>`, `user:<login>`. They are stable across runs, which is what makes share links such as
`?sel=file:src/auth/jwt.ts` work.

## Streaming protocol

`GET /api/analyze/{owner}/{repo}` responds with `application/x-ndjson`: one JSON event per line.

```jsonl
{"type":"stage","stage":"connect","status":"start"}
{"type":"stage","stage":"connect","status":"done","message":"Repository found"}
{"type":"stage","stage":"tree","status":"done","message":"3,281 files"}
{"type":"preview","graph":{"schemaVersion":1,"repository":{...},"files":[...]}}
{"type":"stage","stage":"parse","status":"progress","progress":0.42}
{"type":"heartbeat"}
{"type":"complete","graph":{...}}
```

- `stage` events carry a status (`start`, `progress`, `done`, `skipped`, `warning`), optional progress (0–1) and
  a short result line.
- `preview` carries a structure-only graph for progressive rendering.
- `heartbeat` keeps proxies from closing idle connections during long stages.
- The stream always ends with exactly one `complete` or `error` event. Errors carry a code
  (`NOT_FOUND`, `RATE_LIMITED`, `REF_NOT_FOUND`, ...), user-facing copy and, for rate limits, `retryAt`.

The client reader decodes UTF-8 incrementally, assembles huge lines in linear time and skips malformed lines
instead of aborting. Its state machine (`loading → preview → complete | error`) ignores events after a
terminal state.

## Caching

| Layer          | Key                                                            | Where                                                                                                                    | Holds                                                                                          |
| -------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Graph cache    | `{analyzerVersion}:{repository.id}@{commitSha}:{settingsHash}` | Memory LRU bounded by `CODEVERSE_CACHE_MAX_MB` (6 h TTL); optional disk tier in `CODEVERSE_CACHE_DIR/graphs` (7 day TTL) | Complete `RepositoryGraph`s: structure and metadata, never source code                         |
| Latest pointer | `{analyzerVersion}:latest:{repository.id}`                     | Same tiers (`CODEVERSE_CACHE_DIR/latest`)                                                                                | The key of the most recently served graph of a repository                                      |
| Analysis hub   | the graph key                                                  | Process memory                                                                                                           | In-flight analyses: concurrent requests for the same key share one run and its progress events |
| GitHub ETags   | request URL                                                    | Process memory (bounded LRU)                                                                                             | Repository metadata and commit-list responses, revalidated with `If-None-Match`                |
| Source viewer  | file path at a commit                                          | Browser memory (LRU)                                                                                                     | Files opened during the visit                                                                  |

Refs are resolved to an exact commit before the cache is consulted, so a graph is only reused for the same
commit and a new push produces a new key. The settings hash covers the analysis limits and the provider
capabilities: a server that gains a `GITHUB_TOKEN` produces richer history and does not reuse graphs built
without one. Bumping `ANALYZER_VERSION` (`src/analysis/version.ts`) invalidates every entry.

The disk tier writes one gzip-compressed JSON record per key under a SHA-256 file name (keys never become
paths), validates records on read, writes atomically through a temporary file and prunes by age and total
size. Every cache is best effort: a miss or a broken disk only means recomputing.

## API routes

| Route                                       | Purpose                                                                                              | Per-client limit                                   |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `GET /api/analyze/{owner}/{repo}?ref=`      | Streams the analysis as NDJSON (maximum duration 120 s)                                              | `CODEVERSE_RATE_LIMIT_PER_MINUTE` (default 12/min) |
| `GET /api/source/{owner}/{repo}?ref=&path=` | One file for the source viewer, read from GitHub at an exact commit; sanitized path, size-capped     | 120/min                                            |
| `GET /api/repo/{owner}/{repo}`              | Repository summary (description, stars, languages) without analyzing it                              | 60/min                                             |
| `GET /api/health`                           | Liveness: status, app and analyzer versions, whether a token is configured (never its value), uptime | –                                                  |

## Layout algorithm

[`computeWorldLayout()`](../src/engine/layout/compute-layout.ts) is a pure function from graph to `WorldLayout`
([coordinate contract](../src/engine/layout/types.ts)). It runs in a Web Worker (with a main-thread fallback)
and is deterministic regardless of input array order.

1. **Normalize the tree.** Directories without files are dropped; pass-through chains such as
   `src/main/java/com/acme` get thinner rings so they read as terraces without wasting space.
2. **Encode files.** Footprint grows with the square root of bytes (area ∝ size, saturating at 64 KB);
   height grows with the square root of lines and saturates, so a 50,000-line file never dwarfs the skyline.
   Binary files are flat plots.
3. **Order files.** Inside a directory, files are ordered by a greedy walk of the intra-directory dependency
   graph, so files that import each other end up next to each other.
4. **Plan the city.** A hierarchical squarified treemap (Bruls, Huizing & van Wijk) splits every district into
   one slot per child directory plus one slot for its own files, with padding "streets" between siblings.
   Slots that are too small for their buildings are grown and the plan is re-solved (a bounded number of passes).
5. **Pack buildings.** Files are shelf-packed into their block in order, with column stacking to recover space
   under tall cells.
6. **Emit.** Districts are terraced (level L sits at `y = L × slabHeight`), the world is centered on the origin,
   and invariants are tested: no overlaps, children inside parents, every file has exactly one building.

Symbol bands are computed lazily: a building reads bottom-up like its file reads top-down, so a symbol spanning
lines `[start, end]` becomes a band at the matching height, with nested symbols inset inside their parent.

## Rendering and level of detail

- **Instancing.** Buildings, district slabs and symbol bands are instanced unit boxes placed with scale +
  translation matrices, so tens of thousands of buildings cost a handful of draw calls.
- **Spatial chunks.** Large worlds are split into a grid of chunks, each its own `InstancedMesh` with a tight
  bounding sphere, so whole chunks are frustum-culled and raycasting skips chunks the pointer cannot hit.
- **Encodings.** Each mode (architecture, dependencies, activity, contributors, complexity) maps files to a color,
  an emphasis and a glow; focus, selection and hover are layered on top. Amber (`flare`) is reserved for selection.
- **Labels.** District labels lie flat on their slabs and are chosen by projected size, hierarchy and a hard
  budget, then de-overlapped.
- **Edges.** Only a bounded, meaningful subset of dependency arcs is drawn: the selection's own edges, edges
  inside the focused directory, or the heaviest edges of the repository.
- **Symbol bands.** Shown only for the selected building and a small set of buildings near the camera.
- **Frame budget.** The canvas stops rendering when it is off screen; camera poses are written to the store
  throttled and read with `getState()` so React does not re-render on every frame.
- **Camera.** Orbit mode and an explore ("drone") mode with WASD/QE flight; camera commands (reset, focus,
  fly-to, set pose) go through the store with a nonce so repeated commands are never lost.

## Security boundaries

See [SECURITY.md](../SECURITY.md) for the threat model. In short: only `github.com` repositories are accepted,
every upstream response is schema-validated, paths are sanitized, byte and time budgets bound every stage,
repository code is parsed but never executed, and the UI renders repository data as text only.

## Adding a language

1. **Grammar.** Add the tree-sitter grammar package (it must ship a `.wasm` file) and list the file in
   `scripts/sync-grammars.mjs`. `packageForWasmFile()` in `src/parser/loaders/grammar-files.ts` maps file
   names to packages.
2. **Registry.** In `src/lib/languages/registry.ts`, add the `ParserLanguageId`, route extensions in
   `parserLanguageFor()` and mark the display language as parseable in `isParseableLanguage()`.
3. **Parser module.** Implement a `LanguageModule` in `src/parser/languages/<language>.ts`: declare the node
   types and fields you use in `vocabulary` (tests check them against the real grammar), extract symbols with
   line ranges and parents, imports with their kinds, and exports. Register it in `src/parser/registry.ts`.
   Add tests with realistic snippets, including syntax errors.
4. **Dependency resolver.** Add `src/graph/builders/dependencies/<language>.ts` implementing the resolver
   interface, register its factory in `dependencies/index.ts`, and list any manifests it needs (like `go.mod`)
   in `src/graph/builders/config-files.ts`.
5. **Source viewer.** Map the language to a Shiki grammar in `src/components/code-viewer/language-map.ts`.
6. **Docs.** Update the language table in the README and the language list on the landing page.

## Adding a source provider

1. Implement `RepositorySource` from [src/sources/types.ts](../src/sources/types.ts) in `src/sources/<provider>/`:
   snapshot (metadata and exact commit), tree listing with sanitized POSIX paths, byte-capped file reads,
   commits, commit details and contributors. Declare `capabilities` honestly; optional methods
   (`getFileActivity`, `getCommitCounts`) are only called when the capability is set.
2. Validate every provider response with Zod, throw `SourceError` with the documented codes for expected
   failures, and never expose credentials in errors or logs.
3. Add the provider id to `RepositoryProvider` in the graph model (a contract change: coordinate it), create
   the source in the analysis service (`src/analysis/service.ts`) and extend input parsing so users can reach
   it. Keep the SSRF boundary: never fetch arbitrary user-supplied hosts.
4. Reuse the in-memory provider (`src/sources/memory`) as a reference and for tests. Nothing in `graph`,
   `engine` or `components` should need to change.

## Testing

- **Unit and component tests** (Vitest, `pnpm test`) sit next to the code they cover. Server and engine modules
  run in Node; component tests opt into jsdom with a `// @vitest-environment jsdom` docblock.
- **Fixtures** in `src/fixtures` provide a realistic demo repository and deterministic synthetic graphs of any
  size for layout and performance tests. They are never presented as real data.
- **End-to-end tests** (Playwright, `pnpm test:e2e`) drive the real UI against mocked API responses, so they do
  not depend on GitHub's availability or rate limits. `SCREENSHOTS=1` captures visual QA screenshots.
