import { describe, expect, it, vi } from "vitest";
import type * as RustResolver from "./rust";
import { resolveMiniRepository } from "./test-support";

/**
 * A language resolver that cannot be built (its factory throws on a hostile
 * manifest) must only cost that language its edges.
 */

vi.mock("./rust", async (importOriginal) => {
  const original = await importOriginal<typeof RustResolver>();
  return {
    ...original,
    createRustResolver: () => {
      throw new RangeError("Invalid code point -1");
    },
  };
});

describe("resolver isolation", () => {
  it("keeps other languages' edges when one resolver factory throws", () => {
    const repo = resolveMiniRepository({
      configs: { "Cargo.toml": `[package]\nname = "evil"\n` },
      sources: {
        "web/a.ts": ["./b"],
        "web/b.ts": [],
        "src/main.rs": [{ specifier: "crate::util", kind: "import" }],
        "src/util.rs": [],
      },
    });
    expect(repo.target("web/a.ts", "./b")).toBe("web/b.ts");
    expect(repo.ref("src/main.rs", "crate::util")).toMatchObject({ external: false });
    expect(repo.target("src/main.rs", "crate::util")).toBeNull();
    expect(repo.result.stats.importsFound).toBe(2);
  });
});
