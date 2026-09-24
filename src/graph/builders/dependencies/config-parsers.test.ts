import { describe, expect, it } from "vitest";
import { parseJsonc } from "./jsonc";
import { parseToml, tomlGet } from "./toml";

describe("parseJsonc", () => {
  it("accepts comments and trailing commas without touching string contents", () => {
    const parsed = parseJsonc(`﻿{
      // line comment
      "url": "https://example.com/a//b", /* block
      comment */ "glob": "src/**/*.ts",
      "escaped": "quote \\" // not a comment",
      "list": [1, 2, 3,],
    }`);
    expect(parsed).toEqual({
      url: "https://example.com/a//b",
      glob: "src/**/*.ts",
      escaped: 'quote " // not a comment',
      list: [1, 2, 3],
    });
  });

  it("returns undefined for invalid documents instead of throwing", () => {
    expect(parseJsonc("{ nope")).toBeUndefined();
    expect(parseJsonc("")).toBeUndefined();
  });
});

describe("parseToml", () => {
  it("parses the Cargo.toml and pyproject.toml constructs resolvers rely on", () => {
    const toml = parseToml(`
# comment
[package]
name = "acme-core" # trailing comment
version = "0.1.0"
edition = '2021'

[lib]
path = "src/core.rs"

[dependencies]
serde = { version = "1.0", features = ["derive", "rc"] }
tokio.workspace = true

[[bin]]
name = "one"
path = "src/bin/one.rs"

[[bin]]
name = "two"

[tool.setuptools.packages.find]
where = [
  "src", # multi-line array with comments
  "lib",
]
"quoted.key" = """multi
line"""
`);
    expect(tomlGet(toml, "package", "name")).toBe("acme-core");
    expect(tomlGet(toml, "package", "edition")).toBe("2021");
    expect(tomlGet(toml, "lib", "path")).toBe("src/core.rs");
    expect(tomlGet(toml, "dependencies", "serde", "features")).toEqual(["derive", "rc"]);
    expect(tomlGet(toml, "dependencies", "tokio", "workspace")).toBe(true);
    const bins = tomlGet(toml, "bin");
    expect(Array.isArray(bins) && bins.length).toBe(2);
    expect(tomlGet(toml, "tool", "setuptools", "packages", "find", "where")).toEqual([
      "src",
      "lib",
    ]);
    expect(tomlGet(toml, "tool", "setuptools", "packages", "find", "quoted.key")).toBe(
      "multi\nline",
    );
  });

  it("skips malformed lines and keys below broken headers instead of failing", () => {
    const toml = parseToml(
      `[package]\nname = "ok"\nbroken = = 1\n[bad header\nleak = "no"\n[lib]\npath = "x.rs"`,
    );
    expect(tomlGet(toml, "package", "name")).toBe("ok");
    expect(tomlGet(toml, "package", "leak")).toBeUndefined();
    expect(tomlGet(toml, "lib", "path")).toBe("x.rs");
  });

  it("decodes valid unicode escapes", () => {
    const toml = parseToml(`a = "caf${"\\"}u00e9"` + "\n" + String.raw`b = "\U0001F600"`);
    expect(tomlGet(toml, "a")).toBe("café");
    expect(tomlGet(toml, "b")).toBe("\u{1F600}");
  });

  it.each([
    ["a negative 4-digit escape", String.raw`"evil\u-001"`],
    ["a negative 8-digit escape", String.raw`"evil\U-0000001"`],
    ["a short escape", String.raw`"\u12"`],
    ["a surrogate", String.raw`"\uD800"`],
    ["a code point above U+10FFFF", String.raw`"\U00110000"`],
  ])("skips a line with %s instead of throwing", (_label, value) => {
    const toml = parseToml(`[package]\nname = ${value}\nversion = "1.0.0"\n`);
    expect(tomlGet(toml, "package", "name")).toBeUndefined();
    expect(tomlGet(toml, "package", "version")).toBe("1.0.0");
  });

  it("keeps prototype-like keys inert", () => {
    const toml = parseToml(`[__proto__]\npolluted = true\n`);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(tomlGet(toml, "__proto__", "polluted")).toBe(true);
  });
});
