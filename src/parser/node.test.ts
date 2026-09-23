import { getServerParser } from "./node";

describe("getServerParser", () => {
  it("returns one shared parser backed by the on-disk grammars", async () => {
    const parser = getServerParser();
    expect(getServerParser()).toBe(parser);
    const outcome = await parser.parse({
      path: "cmd/main.go",
      content: 'package main\n\nimport "fmt"\n\nfunc main() { fmt.Println("hi") }\n',
      language: "go",
    });
    expect(outcome).toMatchObject({
      ok: true,
      packageName: "main",
      imports: [{ specifier: "fmt", kind: "import", line: 3 }],
      symbols: [{ name: "main", kind: "function", startLine: 5, endLine: 5, exported: false }],
    });
  });
});
