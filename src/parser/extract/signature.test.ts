import { MAX_SIGNATURE_LENGTH, clipSignature, signatureFromRange } from "./signature";

function head(text: string, prefix?: string): string | undefined {
  return signatureFromRange(text, 0, text.length, prefix);
}

describe("signatureFromRange", () => {
  it("collapses whitespace across lines", () => {
    expect(head("function  handle(\n  request: Request,\n  context: Context,\n): Response ")).toBe(
      "function handle( request: Request, context: Context, ): Response",
    );
  });

  it.each([
    ["class A extends B {", "class A extends B"],
    ["def run(self) -> int:", "def run(self) -> int"],
    ["(req: Request) =>", "(req: Request)"],
    ["const MAX: number =", "const MAX: number"],
    ["abstract run(): void;", "abstract run(): void"],
  ])("removes the trailing body opener of %j", (text, expected) => {
    expect(head(text)).toBe(expected);
  });

  it("prepends a prefix", () => {
    expect(head("handler = async (req) =>", "const")).toBe("const handler = async (req)");
  });

  it("returns the prefix for empty ranges and undefined for empty heads", () => {
    expect(signatureFromRange("abc", 2, 2, "type")).toBe("type");
    expect(signatureFromRange("   ", 0, 3)).toBeUndefined();
  });

  it("clips long heads to the maximum length with an ellipsis", () => {
    const signature = head(`function f(${"argument: string, ".repeat(30)})`);
    expect(signature).toBeDefined();
    expect(signature?.length).toBeLessThanOrEqual(MAX_SIGNATURE_LENGTH);
    expect(signature?.endsWith("…")).toBe(true);
  });

  it("marks heads cut by the scan limit as clipped even when short after collapsing", () => {
    const text = `function f(${" ".repeat(5_000)}x)`;
    const signature = head(text);
    expect(signature).toBe("function f(…");
  });
});

describe("clipSignature", () => {
  it("keeps short text unchanged", () => {
    expect(clipSignature("short")).toBe("short");
  });

  it("never splits a surrogate pair", () => {
    const text = `${"a".repeat(MAX_SIGNATURE_LENGTH - 2)}😀😀😀`;
    const clipped = clipSignature(text);
    expect(clipped.length).toBeLessThanOrEqual(MAX_SIGNATURE_LENGTH);
    expect(clipped.endsWith("…")).toBe(true);
    // A lone high surrogate would appear right before the ellipsis.
    const beforeEllipsis = clipped.charCodeAt(clipped.length - 2);
    expect(beforeEllipsis >= 0xd800 && beforeEllipsis <= 0xdbff).toBe(false);
  });
});
