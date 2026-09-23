import { parseOk, signatureOf, source, symbolRows } from "@/parser/test-helpers";

describe("TypeScript extraction", () => {
  const authService = source(
    'import type { User } from "./models";', // 1
    'import jwt, { sign as signToken, type Secret } from "jsonwebtoken";', // 2
    'import * as path from "node:path";', // 3
    'import "reflect-metadata";', // 4
    'import fs = require("fs");', // 5
    "", // 6
    "export const MAX_ATTEMPTS = 5;", // 7
    "const cache = new Map<string, User>();", // 8
    "let retries = 0;", // 9
    "", // 10
    "export interface Credentials {", // 11
    "  user: string;", // 12
    "  password: string;", // 13
    "}", // 14
    "", // 15
    'export type Role = "admin" | "user";', // 16
    "", // 17
    "export enum Status {", // 18
    "  Active,", // 19
    "  Locked,", // 20
    "}", // 21
    "", // 22
    "@Injectable()", // 23
    "export abstract class AuthService<T extends User> implements Service {", // 24
    "  private readonly attempts = new Map<string, number>();", // 25
    "", // 26
    "  constructor(private readonly secret: Secret) {}", // 27
    "", // 28
    "  get name(): string {", // 29
    '    return "auth";', // 30
    "  }", // 31
    "", // 32
    "  @Log()", // 33
    "  async login(credentials: Credentials): Promise<T> {", // 34
    "    const token = signToken(credentials, this.secret);", // 35
    "    return this.verify(token);", // 36
    "  }", // 37
    "", // 38
    "  protected abstract verify(token: string): Promise<T>;", // 39
    "", // 40
    "  private handle = (event: Event): void => {};", // 41
    "", // 42
    "  #reset(): void {}", // 43
    "}", // 44
    "", // 45
    "export const createToken = async (user: User): Promise<string> => {", // 46
    '  const { encode } = await import("./codec");', // 47
    "  return encode(user);", // 48
    "};", // 49
    "", // 50
    "function* ids(): Generator<number> {", // 51
    "  yield retries++;", // 52
    "}", // 53
    "", // 54
    "export default function authenticate(token: string): boolean {", // 55
    '  const legacy = require("./legacy");', // 56
    "  return legacy.check(token);", // 57
    "}", // 58
  );

  it("extracts declarations with kinds, lines, visibility and nesting", async () => {
    const result = await parseOk("typescript", authService);
    expect(symbolRows(result)).toEqual([
      { name: "MAX_ATTEMPTS", kind: "constant", lines: [7, 7], exported: true },
      { name: "Credentials", kind: "interface", lines: [11, 14], exported: true },
      { name: "Role", kind: "type", lines: [16, 16], exported: true },
      { name: "Status", kind: "enum", lines: [18, 21], exported: true },
      { name: "AuthService", kind: "class", lines: [23, 44], exported: true },
      {
        name: "constructor",
        kind: "method",
        lines: [27, 27],
        exported: true,
        parent: "AuthService",
      },
      { name: "name", kind: "method", lines: [29, 31], exported: true, parent: "AuthService" },
      { name: "login", kind: "method", lines: [33, 37], exported: true, parent: "AuthService" },
      { name: "verify", kind: "method", lines: [39, 39], exported: false, parent: "AuthService" },
      { name: "handle", kind: "method", lines: [41, 41], exported: false, parent: "AuthService" },
      { name: "#reset", kind: "method", lines: [43, 43], exported: false, parent: "AuthService" },
      { name: "createToken", kind: "function", lines: [46, 49], exported: true },
      { name: "ids", kind: "function", lines: [51, 53], exported: false },
      { name: "authenticate", kind: "function", lines: [55, 58], exported: true },
    ]);
    expect(result.hasErrors).toBe(false);
    expect(result.lines).toBe(58);
    expect(result.language).toBe("typescript");
    expect(result.packageName).toBeUndefined();
  });

  it("builds single-line signatures up to the body", async () => {
    const result = await parseOk("typescript", authService);
    expect(signatureOf(result, "AuthService")).toBe(
      "abstract class AuthService<T extends User> implements Service",
    );
    expect(signatureOf(result, "login")).toBe("async login(credentials: Credentials): Promise<T>");
    expect(signatureOf(result, "verify")).toBe(
      "protected abstract verify(token: string): Promise<T>",
    );
    expect(signatureOf(result, "createToken")).toBe(
      "const createToken = async (user: User): Promise<string>",
    );
    expect(signatureOf(result, "MAX_ATTEMPTS")).toBe("const MAX_ATTEMPTS");
    expect(signatureOf(result, "Role")).toBe("type Role");
    expect(signatureOf(result, "ids")).toBe("function* ids(): Generator<number>");
    expect(signatureOf(result, "authenticate")).toBe(
      "function authenticate(token: string): boolean",
    );
    expect(signatureOf(result, "handle")).toBe("private handle = (event: Event): void");
  });

  it("extracts every kind of import in source order", async () => {
    const result = await parseOk("typescript", authService);
    expect(result.imports).toEqual([
      { specifier: "./models", kind: "type-import", line: 1, names: ["User"] },
      {
        specifier: "jsonwebtoken",
        kind: "import",
        line: 2,
        names: ["default", "sign", "Secret"],
      },
      { specifier: "node:path", kind: "import", line: 3, names: ["*"] },
      { specifier: "reflect-metadata", kind: "import", line: 4 },
      { specifier: "fs", kind: "require", line: 5, names: ["*"] },
      { specifier: "./codec", kind: "dynamic-import", line: 47 },
      { specifier: "./legacy", kind: "require", line: 56 },
    ]);
  });

  it('lists exported names with default exports as "default"', async () => {
    const result = await parseOk("typescript", authService);
    expect(result.exports).toEqual([
      "MAX_ATTEMPTS",
      "Credentials",
      "Role",
      "Status",
      "AuthService",
      "createToken",
      "default",
    ]);
  });

  it("handles re-exports, export clauses and export default of local names", async () => {
    const result = await parseOk(
      "typescript",
      source(
        'export * from "./errors";', // 1
        'export * as validators from "./validators";', // 2
        'export { parse, format as formatDate } from "./dates";', // 3
        'export type { Options } from "./options";', // 4
        "const helper = () => 1;", // 5
        "const LIMIT = 10;", // 6
        "let hidden = 1;", // 7
        "class Registry {}", // 8
        "export { helper, LIMIT as MAX };", // 9
        "export default Registry;", // 10
      ),
    );
    expect(result.imports).toEqual([
      { specifier: "./errors", kind: "re-export", line: 1, names: ["*"] },
      { specifier: "./validators", kind: "re-export", line: 2, names: ["*"] },
      { specifier: "./dates", kind: "re-export", line: 3, names: ["parse", "format"] },
      { specifier: "./options", kind: "re-export", line: 4, names: ["Options"] },
    ]);
    expect(result.exports).toEqual([
      "validators",
      "parse",
      "formatDate",
      "Options",
      "helper",
      "MAX",
      "default",
    ]);
    // Plain variables are only kept when they are exported (here via the clause).
    expect(symbolRows(result)).toEqual([
      { name: "helper", kind: "function", lines: [5, 5], exported: true },
      { name: "LIMIT", kind: "constant", lines: [6, 6], exported: true },
      { name: "Registry", kind: "class", lines: [8, 8], exported: true },
    ]);
  });

  it("folds overload signatures into their implementation", async () => {
    const result = await parseOk(
      "typescript",
      source(
        "export function parse(input: string): Date;", // 1
        "export function parse(input: number): Date;", // 2
        "export function parse(input: string | number): Date {", // 3
        "  return new Date(input);", // 4
        "}", // 5
        "class Clock {", // 6
        "  now(): Date;", // 7
        "  now(offset: number): Date;", // 8
        "  now(offset = 0): Date { return new Date(Date.now() + offset); }", // 9
        "  stop?(): void;", // 10
        "}", // 11
        "declare function tick(): void;", // 12
      ),
    );
    expect(symbolRows(result)).toEqual([
      { name: "parse", kind: "function", lines: [3, 5], exported: true },
      { name: "Clock", kind: "class", lines: [6, 11], exported: false },
      { name: "now", kind: "method", lines: [9, 9], exported: false, parent: "Clock" },
      { name: "stop", kind: "method", lines: [10, 10], exported: false, parent: "Clock" },
      { name: "tick", kind: "function", lines: [12, 12], exported: false },
    ]);
    expect(signatureOf(result, "tick")).toBe("function tick(): void");
  });

  it("nests namespaces and ambient modules with implicit exports", async () => {
    const result = await parseOk(
      "typescript",
      source(
        "export namespace Geometry {", // 1
        "  export function area(): number { return 0; }", // 2
        "  function internal(): void {}", // 3
        "  export namespace Units { export const METER = 1; }", // 4
        "}", // 5
        "namespace Local { export function util() {} }", // 6
        'declare module "virtual:config" {', // 7
        "  const value: string;", // 8
        "  export default value;", // 9
        "}", // 10
        "declare global {", // 11
        "  interface Window { app: unknown }", // 12
        "}", // 13
        "module Legacy.Core {}", // 14
      ),
    );
    expect(symbolRows(result)).toEqual([
      { name: "Geometry", kind: "module", lines: [1, 5], exported: true },
      { name: "area", kind: "function", lines: [2, 2], exported: true, parent: "Geometry" },
      { name: "internal", kind: "function", lines: [3, 3], exported: false, parent: "Geometry" },
      { name: "Units", kind: "module", lines: [4, 4], exported: true, parent: "Geometry" },
      { name: "METER", kind: "constant", lines: [4, 4], exported: true, parent: "Units" },
      { name: "Local", kind: "module", lines: [6, 6], exported: false },
      { name: "util", kind: "function", lines: [6, 6], exported: false, parent: "Local" },
      { name: "virtual:config", kind: "module", lines: [7, 10], exported: true },
      {
        name: "value",
        kind: "variable",
        lines: [8, 8],
        exported: true,
        parent: "virtual:config",
      },
      { name: "global", kind: "module", lines: [11, 13], exported: true },
      { name: "Window", kind: "interface", lines: [12, 12], exported: true, parent: "global" },
      { name: "Legacy.Core", kind: "module", lines: [14, 14], exported: false },
    ]);
    expect(result.exports).toEqual(["Geometry"]);
  });

  it('names anonymous default exports "default" and unwraps wrapped initializers', async () => {
    const result = await parseOk(
      "typescript",
      source(
        "export default class extends Base {", // 1
        "  render() {}", // 2
        "}", // 3
        "export const handler = (async (event: Event) => {}) satisfies Handler;", // 4
        "export const Widget = class Named {};", // 5
        "export = Widget;", // 6
      ),
    );
    expect(symbolRows(result)).toEqual([
      { name: "default", kind: "class", lines: [1, 3], exported: true },
      { name: "render", kind: "method", lines: [2, 2], exported: true, parent: "default" },
      { name: "handler", kind: "function", lines: [4, 4], exported: true },
      { name: "Widget", kind: "class", lines: [5, 5], exported: true },
    ]);
    expect(signatureOf(result, "default")).toBe("export default class extends Base");
    expect(signatureOf(result, "Widget")).toBe("const Widget = class Named");
    expect(result.exports).toEqual(["default", "handler", "Widget"]);
  });

  it("ignores non-literal require and import calls", async () => {
    const result = await parseOk(
      "typescript",
      source(
        "const name = './x';",
        "require(name);",
        "import(`./pages/${name}`);",
        "import(`./static`);",
        "require.resolve('./not-an-import');",
        "loader.require('./method-call');",
      ),
    );
    expect(result.imports).toEqual([{ specifier: "./static", kind: "dynamic-import", line: 4 }]);
  });

  it("covers default-exported declarations, declared namespaces and destructured exports", async () => {
    const result = await parseOk(
      "typescript",
      source(
        "export default abstract class Repository {", // 1
        "  abstract find(id: string): Promise<unknown>;", // 2
        "}", // 3
        "export declare namespace Env {", // 4
        "  function read(key: string): string;", // 5
        "  const mode: string;", // 6
        "}", // 7
        'declare module "*.svg";', // 8
        "export const { host, port: listenPort, tls = false, ...rest } = config;", // 9
        "export const [first, [second]] = pairs;", // 10
      ),
    );
    expect(symbolRows(result)).toEqual([
      { name: "Repository", kind: "class", lines: [1, 3], exported: true },
      { name: "find", kind: "method", lines: [2, 2], exported: true, parent: "Repository" },
      { name: "Env", kind: "module", lines: [4, 7], exported: true },
      { name: "read", kind: "function", lines: [5, 5], exported: true, parent: "Env" },
      { name: "mode", kind: "variable", lines: [6, 6], exported: true, parent: "Env" },
      { name: "*.svg", kind: "module", lines: [8, 8], exported: true },
    ]);
    expect(result.exports).toEqual([
      "default",
      "Env",
      "host",
      "listenPort",
      "tls",
      "rest",
      "first",
      "second",
    ]);
  });
});

describe("TSX extraction", () => {
  it("parses JSX components with the TSX grammar", async () => {
    const result = await parseOk(
      "tsx",
      source(
        'import { useState, type ReactNode } from "react";', // 1
        'import styles from "./button.module.css";', // 2
        "", // 3
        "interface ButtonProps { children: ReactNode; onPress?: () => void }", // 4
        "", // 5
        "export function Button({ children, onPress }: ButtonProps) {", // 6
        "  const [pressed, setPressed] = useState(false);", // 7
        "  return (", // 8
        "    <button className={styles.root} onClick={() => setPressed(!pressed)}>", // 9
        "      {children}", // 10
        "    </button>", // 11
        "  );", // 12
        "}", // 13
        "", // 14
        "export const Icon = <T,>(props: { value: T }) => <span>{String(props.value)}</span>;", // 15
        "", // 16
        "export default function Page() {", // 17
        "  return <Button>Go</Button>;", // 18
        "}", // 19
      ),
    );
    expect(result.hasErrors).toBe(false);
    expect(result.language).toBe("tsx");
    expect(symbolRows(result)).toEqual([
      { name: "ButtonProps", kind: "interface", lines: [4, 4], exported: false },
      { name: "Button", kind: "function", lines: [6, 13], exported: true },
      { name: "Icon", kind: "function", lines: [15, 15], exported: true },
      { name: "Page", kind: "function", lines: [17, 19], exported: true },
    ]);
    expect(result.imports).toEqual([
      { specifier: "react", kind: "import", line: 1, names: ["useState", "ReactNode"] },
      { specifier: "./button.module.css", kind: "import", line: 2, names: ["default"] },
    ]);
    expect(result.exports).toEqual(["Button", "Icon", "default"]);
  });
});
