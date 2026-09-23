import { describe, expect, it } from "vitest";
import { analyzeRepository } from "@/analysis/pipeline";
import { ANALYSIS_STAGES, type AnalysisEvent } from "@/analysis/protocol";
import { expectConsistent } from "@/graph/builders/test-consistency";
import { DEFAULT_LIMITS } from "@/lib/config/limits";
import { silentLogger } from "@/lib/observability/logger";
import { getServerParser } from "@/parser/node";
import { GitHubClient, GitHubSource } from "@/sources/github";

/**
 * Live smoke test against the real GitHub API: proves that real ingestion,
 * parsing and graph construction work end to end.
 *
 * Opt-in only (it needs network access and consumes API quota):
 *   E2E_LIVE=1 pnpm exec vitest run tests/integration/github-live.test.ts
 * GITHUB_TOKEN is used when set (never logged).
 */

const LIVE = process.env.E2E_LIVE === "1";

describe.skipIf(!LIVE)("live GitHub analysis", () => {
  it(
    "analyzes octocat/Hello-World through the real GitHubSource",
    { timeout: 120_000 },
    async () => {
      const client = new GitHubClient({ token: process.env.GITHUB_TOKEN?.trim() || undefined });
      const source = new GitHubSource({ owner: "octocat", repo: "Hello-World", client });
      const events: AnalysisEvent[] = [];
      const graph = await analyzeRepository(source, {
        limits: DEFAULT_LIMITS,
        parser: getServerParser(),
        emit: (event) => events.push(event),
        logger: silentLogger,
      });

      expectConsistent(graph);
      expect(graph.repository).toMatchObject({
        id: "github:octocat/Hello-World",
        provider: "github",
      });
      expect(graph.repository.commitSha).toMatch(/^[0-9a-f]{40}$/);
      expect(graph.files.map((file) => file.path)).toContain("README");
      expect(graph.analysis.coverage.bytesDownloaded).toBeGreaterThan(0);
      expect(graph.commits.length).toBeGreaterThan(0);
      const stages = new Set(
        events.flatMap((event) => (event.type === "stage" ? [event.stage] : [])),
      );
      expect([...stages]).toEqual([...ANALYSIS_STAGES]);
      expect(events.at(-1)?.type).toBe("complete");
    },
  );
});
