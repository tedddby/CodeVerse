import type { SourceSnapshot } from "@/sources/types";
import commitDetailsFixture from "./commit-details.json";
import commitFixture from "./commit.json";
import contributorsFixture from "./contributors.json";
import repositoryFixture from "./repository.json";
import treeFixture from "./tree.json";

/** Small, realistic GitHub API payloads (trimmed) used across the GitHub tests. */
export { commitDetailsFixture, commitFixture, contributorsFixture, repositoryFixture, treeFixture };

export const SNAPSHOT_SHA = "9fb037999f264ba9a7fc6274d15fa3ae2ab98312";

/** A resolved snapshot as produced by `GitHubSource.getSnapshot`. */
export function makeSnapshot(
  overrides: Partial<SourceSnapshot["repository"]> = {},
): SourceSnapshot {
  return {
    repository: {
      id: "github:facebook/react",
      provider: "github",
      owner: "facebook",
      name: "react",
      fullName: "facebook/react",
      url: "https://github.com/facebook/react",
      defaultBranch: "main",
      ref: "main",
      commitSha: SNAPSHOT_SHA,
      stars: 0,
      forks: 0,
      topics: [],
      ...overrides,
    },
  };
}

/** A REST commit payload with a deterministic SHA derived from `index`. */
export function makeCommitPayload(index: number, overrides: Record<string, unknown> = {}) {
  const sha = index.toString(16).padStart(40, "0");
  return {
    sha,
    html_url: `https://github.com/facebook/react/commit/${sha}`,
    commit: {
      message: `Commit number ${index}\n\nDetails`,
      author: {
        name: `Author ${index % 5}`,
        email: "hidden@example.com",
        date: new Date(Date.UTC(2026, 0, 1) - index * 3_600_000).toISOString(),
      },
      committer: {
        name: "GitHub",
        date: new Date(Date.UTC(2026, 0, 1) - index * 3_600_000).toISOString(),
      },
    },
    author: {
      login: `user${index % 5}`,
      avatar_url: `https://avatars.githubusercontent.com/u/${index % 5}?v=4`,
    },
    ...overrides,
  };
}
