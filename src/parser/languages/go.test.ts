import { parseOk, signatureOf, source, symbolRows } from "@/parser/test-helpers";

describe("Go extraction", () => {
  const server = source(
    "// Package auth issues tokens.", // 1
    "package auth", // 2
    "", // 3
    'import "fmt"', // 4
    "import (", // 5
    '\t"net/http"', // 6
    '\tjwt "github.com/golang-jwt/jwt/v5"', // 7
    '\t_ "embed"', // 8
    "\t`strings`", // 9
    ")", // 10
    "", // 11
    "const MaxRetries = 3", // 12
    "const (", // 13
    "\tdefaultTTL = 10", // 14
    '\tVersion    = "1.2.0"', // 15
    ")", // 16
    "", // 17
    'var ErrInvalid = fmt.Errorf("invalid token")', // 18
    "var cache = map[string]string{}", // 19
    "", // 20
    "func (s *Server) Login(user string) (string, error) {", // 21
    '\treturn "", nil', // 22
    "}", // 23
    "", // 24
    "type Server struct {", // 25
    "\tclient *http.Client", // 26
    "}", // 27
    "", // 28
    "type Store interface {", // 29
    "\tGet(id string) (string, error)", // 30
    "}", // 31
    "", // 32
    "type (", // 33
    "\tID    string", // 34
    "\tAlias = ID", // 35
    "\tbox[T any] struct{ value T }", // 36
    ")", // 37
    "", // 38
    "func NewServer(client *http.Client) *Server {", // 39
    "\treturn &Server{client: client}", // 40
    "}", // 41
    "", // 42
    "func (b box[T]) get() T { return b.value }", // 43
    "func (Unknown) Orphan() {}", // 44
    "func helper() {}", // 45
  );

  it("reads the package clause and imports (single, grouped, aliased, raw)", async () => {
    const result = await parseOk("go", server);
    expect(result.packageName).toBe("auth");
    expect(result.imports).toEqual([
      { specifier: "fmt", kind: "import", line: 4 },
      { specifier: "net/http", kind: "import", line: 6 },
      { specifier: "github.com/golang-jwt/jwt/v5", kind: "import", line: 7 },
      { specifier: "embed", kind: "import", line: 8 },
      { specifier: "strings", kind: "import", line: 9 },
    ]);
  });

  it("extracts functions, types, exported values and resolves method receivers", async () => {
    const result = await parseOk("go", server);
    expect(result.hasErrors).toBe(false);
    expect(symbolRows(result)).toEqual([
      { name: "MaxRetries", kind: "constant", lines: [12, 12], exported: true },
      { name: "Version", kind: "constant", lines: [15, 15], exported: true },
      { name: "ErrInvalid", kind: "variable", lines: [18, 18], exported: true },
      // Declared before its receiver type: the parent is resolved after the walk.
      { name: "Login", kind: "method", lines: [21, 23], exported: true, parent: "Server" },
      { name: "Server", kind: "struct", lines: [25, 27], exported: true },
      { name: "Store", kind: "interface", lines: [29, 31], exported: true },
      { name: "ID", kind: "type", lines: [34, 34], exported: true },
      { name: "Alias", kind: "type", lines: [35, 35], exported: true },
      { name: "box", kind: "struct", lines: [36, 36], exported: false },
      { name: "NewServer", kind: "function", lines: [39, 41], exported: true },
      { name: "get", kind: "method", lines: [43, 43], exported: false, parent: "box" },
      { name: "Orphan", kind: "method", lines: [44, 44], exported: true },
      { name: "helper", kind: "function", lines: [45, 45], exported: false },
    ]);
    expect(result.exports).toEqual([
      "MaxRetries",
      "Version",
      "ErrInvalid",
      "Server",
      "Store",
      "ID",
      "Alias",
      "NewServer",
    ]);
  });

  it("builds Go signatures", async () => {
    const result = await parseOk("go", server);
    expect(signatureOf(result, "Login")).toBe(
      "func (s *Server) Login(user string) (string, error)",
    );
    expect(signatureOf(result, "Server")).toBe("type Server struct");
    expect(signatureOf(result, "Store")).toBe("type Store interface");
    expect(signatureOf(result, "Alias")).toBe("type Alias = ID");
    expect(signatureOf(result, "box")).toBe("type box[T any] struct");
    expect(signatureOf(result, "Version")).toBe("const Version");
    expect(signatureOf(result, "ErrInvalid")).toBe("var ErrInvalid");
  });

  it("treats Unicode upper-case initials as exported", async () => {
    const result = await parseOk("go", source("package ü", "func Über() {}", "func ärger() {}"));
    expect(result.packageName).toBe("ü");
    expect(symbolRows(result)).toEqual([
      { name: "Über", kind: "function", lines: [2, 2], exported: true },
      { name: "ärger", kind: "function", lines: [3, 3], exported: false },
    ]);
  });
});
