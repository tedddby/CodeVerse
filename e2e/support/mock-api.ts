import type { Page, Route } from "@playwright/test";
import { encodeEvent, NDJSON_CONTENT_TYPE, type AnalysisEvent } from "../../src/analysis/protocol";
import type { SourceFileResponse } from "../../src/analysis/source-protocol";
import type { RepositoryGraph } from "../../src/graph/model/types";
import { mockRepositoryGraph } from "../../src/fixtures/mock-repository-graph";

/**
 * Browser-level API mocks for E2E tests.
 *
 * The E2E suite exercises the real UI (landing page → loading experience →
 * explorer → selection → source viewer) without depending on GitHub's
 * availability or rate limits. Server-side ingestion is covered by the
 * integration tests (and the opt-in live test with E2E_LIVE=1).
 */

/** The fixture graph, presented as a GitHub repository so provider-specific UI (source viewer) is exercised. */
export const e2eGraph: RepositoryGraph = {
  ...mockRepositoryGraph,
  repository: {
    ...mockRepositoryGraph.repository,
    provider: "github",
    id: `github:${mockRepositoryGraph.repository.fullName}`,
  },
};

export const FIXTURE_OWNER = e2eGraph.repository.owner;
export const FIXTURE_REPO = e2eGraph.repository.name;

function analysisEvents(graph: RepositoryGraph): AnalysisEvent[] {
  const fileCount = graph.analysis.coverage.filesInRepository;
  return [
    { type: "stage", stage: "connect", status: "start" },
    { type: "stage", stage: "connect", status: "done", message: "Repository found" },
    { type: "stage", stage: "tree", status: "start" },
    { type: "stage", stage: "tree", status: "done", message: `${fileCount} files` },
    { type: "stage", stage: "languages", status: "done", message: "TypeScript 71%" },
    { type: "stage", stage: "fetch", status: "progress", progress: 0.5 },
    { type: "stage", stage: "fetch", status: "done", message: `${fileCount} files downloaded` },
    { type: "stage", stage: "parse", status: "progress", progress: 0.71 },
    { type: "stage", stage: "parse", status: "done", message: `${graph.symbols.length} symbols` },
    {
      type: "stage",
      stage: "dependencies",
      status: "done",
      message: `${graph.dependencies.length} dependencies`,
    },
    { type: "stage", stage: "history", status: "done", message: `${graph.commits.length} commits` },
    { type: "stage", stage: "construct", status: "done", message: "Complete" },
    { type: "complete", graph },
  ];
}

export interface MockApiOptions {
  graph?: RepositoryGraph;
  /** Replace the analysis stream with a single error event. */
  analysisError?: Extract<AnalysisEvent, { type: "error" }>["error"];
}

export async function mockAnalysisApi(page: Page, options: MockApiOptions = {}): Promise<void> {
  const graph = options.graph ?? e2eGraph;

  await page.route("**/api/analyze/**", async (route: Route) => {
    const events: AnalysisEvent[] = options.analysisError
      ? [
          { type: "stage", stage: "connect", status: "start" },
          { type: "error", error: options.analysisError },
        ]
      : analysisEvents(graph);
    await route.fulfill({
      status: 200,
      headers: { "content-type": NDJSON_CONTENT_TYPE, "cache-control": "no-store" },
      body: events.map(encodeEvent).join(""),
    });
  });

  await page.route("**/api/source/**", async (route: Route) => {
    const url = new URL(route.request().url());
    const path = url.searchParams.get("path") ?? "";
    const file = graph.files.find((candidate) => candidate.path === path);
    if (!file) {
      await route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({
          error: { code: "NOT_FOUND", title: "File not found.", message: "No such file." },
        }),
      });
      return;
    }
    const content = Array.from({ length: Math.max(1, Math.min(file.lines, 400)) }, (_, i) =>
      i === 0 ? `// ${file.path} — CodeVerse E2E fixture` : `export const line${i + 1} = ${i + 1};`,
    ).join("\n");
    const body: SourceFileResponse = {
      path: file.path,
      ref: graph.repository.commitSha,
      size: content.length,
      content,
      language: file.language,
      lines: content.split("\n").length,
    };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
}
