import { describe, expect, it } from "vitest";
import { cn } from "./cn";

describe("cn", () => {
  it("joins truthy class names", () => {
    expect(cn("a", false, null, undefined, 0, "b  c", "")).toBe("a b c");
  });

  it("lets a later display class override an earlier one", () => {
    // IconButton's base `inline-flex` must not beat an override `hidden`.
    expect(cn("inline-flex items-center", "hidden lg:inline-flex")).toBe(
      "items-center hidden lg:inline-flex",
    );
    expect(cn("flex flex-col", "grid")).toBe("flex-col grid");
  });

  it("lets a later size constraint override an earlier one under the same variants", () => {
    expect(
      cn(
        "glass flex max-h-full flex-col",
        "fixed max-h-[calc(100dvh-8.5rem)] md:max-h-[max(18rem,calc(100dvh-24rem))]",
      ),
    ).toBe(
      "glass flex flex-col fixed max-h-[calc(100dvh-8.5rem)] md:max-h-[max(18rem,calc(100dvh-24rem))]",
    );
    expect(cn("w-9 h-9 min-w-0", "w-full min-h-0")).toBe("h-9 min-w-0 w-full min-h-0");
    expect(cn("relative", "absolute")).toBe("absolute");
  });

  it("keeps classes that differ in variants or importance", () => {
    expect(cn("hidden md:flex max-md:hidden", "md:hidden")).toBe("hidden max-md:hidden md:hidden");
    expect(cn("block", "!hidden", "flex!")).toBe("block flex!");
    expect(cn("[&>svg]:hidden", "[&>svg]:block")).toBe("[&>svg]:block");
  });

  it("does not merge classes whose group is ambiguous by name", () => {
    // `text-*` sets size or color; `size-*` sets both width and height. Both are kept as written.
    expect(cn("text-xs text-ink-muted", "text-ink")).toBe("text-xs text-ink-muted text-ink");
    expect(cn("size-9", "w-full")).toBe("size-9 w-full");
    expect(cn("table-auto", "table")).toBe("table-auto table");
  });

  it("reads colons inside arbitrary values as part of the value", () => {
    expect(cn("h-[calc(100%-1rem)]", "bg-[url(https://x.test/a.png)]", "h-[var(--h,1px)]")).toBe(
      "bg-[url(https://x.test/a.png)] h-[var(--h,1px)]",
    );
  });
});
