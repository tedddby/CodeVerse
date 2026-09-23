import { describe, expect, it } from "vitest";
import { mockRepositoryGraph } from "@/fixtures/mock-repository-graph";
import type { LanguageStat } from "@/graph/model/types";
import { ANALYSIS_STAGES } from "../protocol";
import {
  cachedStageEvents,
  dependenciesMessage,
  fetchMessage,
  historyMessage,
  languageMessage,
  parseMessage,
  treeMessage,
} from "./messages";

function language(id: string, name: string, bytes: number, share: number): LanguageStat {
  return { id, name, color: "#fff", files: 1, bytes, lines: 1, share, parseable: true };
}

describe("stage messages", () => {
  it("formats counts", () => {
    expect(treeMessage(3_281, false)).toBe("3,281 files");
    expect(treeMessage(1, true)).toBe("1 file · listing truncated");
    expect(fetchMessage(1_204, 8.2 * 1024 * 1024)).toBe("1,204 files · 8.2 MB");
    expect(parseMessage(1_180, 0)).toBe("1,180 files parsed");
    expect(parseMessage(1_180, 3)).toBe("1,180 files parsed · 3 failed");
    expect(dependenciesMessage(4_812, 1_203)).toBe("4,812 imports · 1,203 resolved");
    expect(historyMessage(300, 42)).toBe("300 commits · 42 contributors");
    expect(historyMessage(1, 0)).toBe("1 commit");
  });

  it("names the dominant programming language", () => {
    expect(
      languageMessage([
        language("markdown", "Markdown", 900, 0.5),
        language("typescript", "TypeScript", 700, 0.62),
        language("unknown", "Other", 5_000, 0.1),
      ]),
    ).toBe("TypeScript 62%");
    expect(languageMessage([language("markdown", "Markdown", 900, 0.9)])).toBe("Markdown 90%");
    expect(languageMessage([language("unknown", "Other", 10, 1)])).toBe("No recognized languages");
    expect(languageMessage([])).toBe("No recognized languages");
  });
});

describe("cachedStageEvents", () => {
  it("reports every stage as done, in protocol order, from the graph", () => {
    const events = cachedStageEvents(mockRepositoryGraph);
    expect(events.map((event) => event.stage)).toEqual([...ANALYSIS_STAGES]);
    expect(events.every((event) => event.status === "done")).toBe(true);
    expect(events[1]?.message).toBe(
      treeMessage(
        mockRepositoryGraph.analysis.coverage.filesInRepository,
        mockRepositoryGraph.analysis.treeTruncated,
      ),
    );
    expect(events[3]?.message).toBe("Cached");
  });
});
