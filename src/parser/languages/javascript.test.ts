import { parseOk, signatureOf, source, symbolRows } from "@/parser/test-helpers";

describe("JavaScript extraction", () => {
  it("extracts ES module declarations from a JSX file", async () => {
    const result = await parseOk(
      "javascript",
      source(
        'import React, { useEffect } from "react";', // 1
        'import "./styles.css";', // 2
        'export { default as Modal } from "./modal.jsx";', // 3
        "", // 4
        "export const API_URL = process.env.API_URL;", // 5
        "export let theme = 'dark';", // 6
        "", // 7
        "export default function App({ title }) {", // 8
        "  useEffect(() => {", // 9
        "    import('./analytics').then((module) => module.track());", // 10
        "  }, []);", // 11
        '  return <main className="app">{title}</main>;', // 12
        "}", // 13
        "", // 14
        "export class Store extends EventTarget {", // 15
        "  static instances = 0;", // 16
        "  #items = new Map();", // 17
        "  constructor() { super(); }", // 18
        "  get size() { return this.#items.size; }", // 19
        "  onChange = (event) => this.dispatchEvent(event);", // 20
        "  async *entries() { yield* this.#items; }", // 21
        "}", // 22
        "", // 23
        "const Row = ({ label }) => <li>{label}</li>;", // 24
        "function* counter() {}", // 25
        "var legacy = function named() {};", // 26
      ),
    );
    expect(result.hasErrors).toBe(false);
    expect(symbolRows(result)).toEqual([
      { name: "API_URL", kind: "constant", lines: [5, 5], exported: true },
      { name: "theme", kind: "variable", lines: [6, 6], exported: true },
      { name: "App", kind: "function", lines: [8, 13], exported: true },
      { name: "Store", kind: "class", lines: [15, 22], exported: true },
      { name: "constructor", kind: "method", lines: [18, 18], exported: true, parent: "Store" },
      { name: "size", kind: "method", lines: [19, 19], exported: true, parent: "Store" },
      { name: "onChange", kind: "method", lines: [20, 20], exported: true, parent: "Store" },
      { name: "entries", kind: "method", lines: [21, 21], exported: true, parent: "Store" },
      { name: "Row", kind: "function", lines: [24, 24], exported: false },
      { name: "counter", kind: "function", lines: [25, 25], exported: false },
      { name: "legacy", kind: "function", lines: [26, 26], exported: false },
    ]);
    expect(result.imports).toEqual([
      { specifier: "react", kind: "import", line: 1, names: ["default", "useEffect"] },
      { specifier: "./styles.css", kind: "import", line: 2 },
      { specifier: "./modal.jsx", kind: "re-export", line: 3, names: ["default"] },
      { specifier: "./analytics", kind: "dynamic-import", line: 10 },
    ]);
    expect(result.exports).toEqual(["Modal", "API_URL", "theme", "default", "Store"]);
    expect(signatureOf(result, "Row")).toBe("const Row = ({ label })");
    expect(signatureOf(result, "legacy")).toBe("var legacy = function named()");
    expect(signatureOf(result, "entries")).toBe("async *entries()");
  });

  it("understands CommonJS modules", async () => {
    const result = await parseOk(
      "javascript",
      source(
        "'use strict';", // 1
        "const fs = require('fs');", // 2
        'const { join } = require("path");', // 3
        "", // 4
        "function readConfig(file) {", // 5
        "  return JSON.parse(fs.readFileSync(join(__dirname, file), 'utf8'));", // 6
        "}", // 7
        "", // 8
        "class Cache {}", // 9
        "const DEFAULTS = { ttl: 60 };", // 10
        "", // 11
        "exports.version = '1.0.0';", // 12
        "exports.clear = function clear() {};", // 13
        "module.exports.Loader = class {};", // 14
        "module.exports = { readConfig, Cache, defaults: DEFAULTS, 'x-y': 1 };", // 15
      ),
    );
    expect(result.imports).toEqual([
      { specifier: "fs", kind: "require", line: 2 },
      { specifier: "path", kind: "require", line: 3 },
    ]);
    expect(symbolRows(result)).toEqual([
      { name: "readConfig", kind: "function", lines: [5, 7], exported: true },
      { name: "Cache", kind: "class", lines: [9, 9], exported: true },
      { name: "DEFAULTS", kind: "constant", lines: [10, 10], exported: true },
      { name: "clear", kind: "function", lines: [13, 13], exported: true },
      { name: "Loader", kind: "class", lines: [14, 14], exported: true },
    ]);
    expect(result.exports).toEqual([
      "version",
      "clear",
      "Loader",
      "default",
      "readConfig",
      "Cache",
      "defaults",
      "x-y",
    ]);
    expect(signatureOf(result, "Loader")).toBe("module.exports.Loader = class");
  });

  it("marks the local target of module.exports = name as exported", async () => {
    const result = await parseOk(
      "javascript",
      source("function middleware(req, res, next) { next(); }", "module.exports = middleware;"),
    );
    expect(symbolRows(result)).toEqual([
      { name: "middleware", kind: "function", lines: [1, 1], exported: true },
    ]);
    expect(result.exports).toEqual(["default"]);
  });

  it("names a function assigned to module.exports without exporting that name", async () => {
    const result = await parseOk("javascript", "module.exports = function handler(req) {};\n");
    expect(symbolRows(result)).toEqual([
      { name: "handler", kind: "function", lines: [1, 1], exported: true },
    ]);
    expect(result.exports).toEqual(["default"]);
  });

  it("unquotes string-named members and keeps computed names", async () => {
    const result = await parseOk(
      "javascript",
      'class Router { "get-user"() {} [Symbol.iterator]() {} 404() {} }\n',
    );
    expect(result.symbols.map((symbol) => symbol.name)).toEqual([
      "Router",
      "get-user",
      "[Symbol.iterator]",
      "404",
    ]);
  });
});

describe("Flow-typed JavaScript", () => {
  const hooks = source(
    "/**", // 1
    " * Copyright (c) Meta Platforms, Inc. and affiliates.", // 2
    " *", // 3
    " * @flow", // 4
    " */", // 5
    "", // 6
    "import type {Dispatcher} from 'react-reconciler/src/ReactInternalTypes';", // 7
    "import type {ReactContext} from 'shared/ReactTypes';", // 8
    "import ReactSharedInternals from 'shared/ReactSharedInternals';", // 9
    "", // 10
    "type BasicStateAction<S> = (S => S) | S;", // 11
    "type Dispatch<A> = A => void;", // 12
    "", // 13
    "function resolveDispatcher(): Dispatcher {", // 14
    "  const dispatcher = ReactSharedInternals.H;", // 15
    "  return ((dispatcher: any): Dispatcher);", // 16
    "}", // 17
    "", // 18
    "export function useState<S>(", // 19
    "  initialState: (() => S) | S,", // 20
    "): [S, Dispatch<BasicStateAction<S>>] {", // 21
    "  return resolveDispatcher().useState(initialState);", // 22
    "}", // 23
    "", // 24
    "export function useRef<T>(initialValue: T): {current: T} {", // 25
    "  return resolveDispatcher().useRef(initialValue);", // 26
    "}", // 27
    "", // 28
    "export function useContext<T>(Context: ReactContext<T>): T {", // 29
    "  return resolveDispatcher().useContext(Context);", // 30
    "}", // 31
  );

  it("extracts the declarations of a Flow file (ReactHooks-style) and reports it as JavaScript", async () => {
    const result = await parseOk("javascript", hooks);
    expect(result.language).toBe("javascript");
    const functions = result.symbols.filter((symbol) => symbol.kind === "function");
    expect(functions.map((symbol) => [symbol.name, symbol.exported])).toEqual([
      ["resolveDispatcher", false],
      ["useState", true],
      ["useRef", true],
      ["useContext", true],
    ]);
    expect(result.symbols.find((symbol) => symbol.name === "useState")).toMatchObject({
      startLine: 19,
      endLine: 23,
    });
    expect(result.exports).toEqual(["useState", "useRef", "useContext"]);
    expect(result.imports).toEqual([
      {
        specifier: "react-reconciler/src/ReactInternalTypes",
        kind: "type-import",
        line: 7,
        names: ["Dispatcher"],
      },
      { specifier: "shared/ReactTypes", kind: "type-import", line: 8, names: ["ReactContext"] },
      { specifier: "shared/ReactSharedInternals", kind: "import", line: 9, names: ["default"] },
    ]);
  });

  it("also recovers Flow syntax in files without a pragma", async () => {
    const result = await parseOk("javascript", hooks.replace("@flow", ""));
    expect(result.language).toBe("javascript");
    expect(result.exports).toEqual(["useState", "useRef", "useContext"]);
  });

  it("parses a clean Flow component without syntax errors", async () => {
    const result = await parseOk(
      "javascript",
      source(
        "/* @flow strict */", // 1
        "import type {Node} from 'react';", // 2
        "export type Props = {title: string};", // 3
        "export default function Header(props: Props): Node {", // 4
        '  return <h1 className="title">{props.title}</h1>;', // 5
        "}", // 6
      ),
    );
    expect(result.hasErrors).toBe(false);
    expect(symbolRows(result)).toEqual([
      { name: "Props", kind: "type", lines: [3, 3], exported: true },
      { name: "Header", kind: "function", lines: [4, 6], exported: true },
    ]);
    expect(result.exports).toEqual(["Props", "default"]);
  });

  it("keeps plain JavaScript on the JavaScript grammar", async () => {
    const result = await parseOk(
      "javascript",
      source(
        "// Not Flow: a generic-looking comparison.",
        "const ok = a < b && c > d;",
        "export { ok };",
      ),
    );
    expect(result.hasErrors).toBe(false);
    expect(result.symbols.map((symbol) => symbol.name)).toEqual(["ok"]);
  });
});
