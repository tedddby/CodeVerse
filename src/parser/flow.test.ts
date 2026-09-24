import { describe, expect, it } from "vitest";
import { hasFlowPragma } from "./flow";

describe("hasFlowPragma", () => {
  it.each([
    ["a license block", "/**\n * Copyright (c) Meta.\n *\n * @flow\n */\nimport x from 'x';\n"],
    ["a line comment", "// @flow\nconst a = 1;\n"],
    ["a strict pragma", "/* @flow strict-local */\n"],
    ["a noflow pragma", "/**\n * @noflow\n */\n"],
    ["a later leading comment", "// Copyright\n\n/* eslint-disable */\n// @flow\nexport {};\n"],
    ["a shebang line", "#!/usr/bin/env node\n// @flow\nrequire('x');\n"],
  ])("finds the pragma in %s", (_label, source) => {
    expect(hasFlowPragma(source)).toBe(true);
  });

  it.each([
    ["no pragma", "/** Utilities. */\nexport const a = 1;\n"],
    ["a pragma after code", "const a = 1;\n// @flow\n"],
    ["a longer word", "/* @flowtype is not Flow */\n"],
    ["an empty file", ""],
    ["an unterminated comment", "/* @flo"],
  ])("finds none with %s", (_label, source) => {
    expect(hasFlowPragma(source)).toBe(false);
  });

  it("only reads the head of a file", () => {
    expect(hasFlowPragma(`/*${" ".repeat(10_000)}@flow */`)).toBe(false);
  });
});
