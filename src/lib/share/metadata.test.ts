import { describe, expect, it, vi } from "vitest";
import {
  describeRepositoryForMetadata,
  genericRepositoryDescription,
  normalizeInlineText,
  stripEmoji,
  truncateText,
  withTimeout,
} from "./metadata";

describe("withTimeout", () => {
  it("resolves with the task result when it finishes in time", async () => {
    await expect(withTimeout(async () => 42, 1_000)).resolves.toBe(42);
  });

  it("resolves to null and aborts the task on timeout", async () => {
    vi.useFakeTimers();
    try {
      let receivedSignal: AbortSignal | undefined;
      const pending = withTimeout((signal) => {
        receivedSignal = signal;
        return new Promise<number>(() => undefined);
      }, 2_500);
      await vi.advanceTimersByTimeAsync(2_500);
      await expect(pending).resolves.toBeNull();
      expect(receivedSignal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("resolves to null for rejected and synchronously throwing tasks", async () => {
    await expect(withTimeout(() => Promise.reject(new Error("rate limited")), 1_000)).resolves.toBeNull();
    await expect(
      withTimeout(() => {
        throw new Error("boom");
      }, 1_000),
    ).resolves.toBeNull();
  });
});

describe("text helpers", () => {
  it("normalizes whitespace and control characters", () => {
    expect(normalizeInlineText("  A \n\t library\u0000 for UIs ")).toBe("A library for UIs");
  });

  it("truncates at word boundaries with an ellipsis", () => {
    expect(truncateText("short", 10)).toBe("short");
    expect(truncateText("The library for web and native user interfaces", 24)).toBe("The library for web and…");
    expect(Array.from(truncateText("😀".repeat(30), 10))).toHaveLength(10);
  });

  it("strips emoji and GitHub shortcodes but keeps text and times", () => {
    expect(stripEmoji("⚛️ React 🚀 :rocket: fast")).toBe("React fast");
    expect(stripEmoji("Meet at 10:30:00 👍🏽")).toBe("Meet at 10:30:00");
    expect(stripEmoji("日本語のライブラリ")).toBe("日本語のライブラリ");
  });
});

describe("describeRepositoryForMetadata", () => {
  it("combines description, stars and language", () => {
    expect(
      describeRepositoryForMetadata({
        fullName: "facebook/react",
        description: "The library for web and native user interfaces.",
        stars: 238_421,
        forks: 49_000,
        language: "JavaScript",
      }),
    ).toBe("The library for web and native user interfaces. · 238.4K stars · JavaScript");
  });

  it("handles missing description and singular stars", () => {
    expect(describeRepositoryForMetadata({ fullName: "a/b", stars: 1, forks: 0 })).toBe("1 star");
    expect(genericRepositoryDescription("a/b")).toContain("a/b");
  });
});
