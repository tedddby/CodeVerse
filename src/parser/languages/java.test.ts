import { parseOk, signatureOf, source, symbolRows } from "@/parser/test-helpers";

describe("Java extraction", () => {
  const authService = source(
    "package com.acme.auth;", // 1
    "", // 2
    "import java.util.List;", // 3
    "import java.util.concurrent.*;", // 4
    "import static org.junit.Assert.assertEquals;", // 5
    "import static org.junit.Assert.*;", // 6
    "import static java.util.concurrent.TimeUnit.SECONDS;", // 7
    "import static com.acme.Outer.Nested;", // 8
    "", // 9
    "@Service", // 10
    "public final class AuthService<T extends User> extends Base implements Api {", // 11
    "    private static final int MAX = 3;", // 12
    "", // 13
    "    public AuthService(String secret) {", // 14
    "        super();", // 15
    "    }", // 16
    "", // 17
    "    @Override", // 18
    "    public <R> List<R> login(String user) throws AuthException {", // 19
    "        return List.of();", // 20
    "    }", // 21
    "", // 22
    "    private void audit() {}", // 23
    "", // 24
    "    static class Session {", // 25
    "        void close() {}", // 26
    "    }", // 27
    "", // 28
    "    public enum Role {", // 29
    "        ADMIN, USER;", // 30
    "        public boolean isAdmin() { return this == ADMIN; }", // 31
    "    }", // 32
    "", // 33
    "    interface Callback {", // 34
    "        void call(String value);", // 35
    "        private void helper() {}", // 36
    "    }", // 37
    "}", // 38
    "", // 39
    "record Point(int x, int y) {", // 40
    "    Point {", // 41
    "        if (x < 0) throw new IllegalArgumentException();", // 42
    "    }", // 43
    "}", // 44
    "", // 45
    "@interface Audited {}", // 46
    "", // 47
    "abstract class Shape {", // 48
    "    abstract double area();", // 49
    "}", // 50
  );

  it("reads the package declaration", async () => {
    const result = await parseOk("java", authService);
    expect(result.packageName).toBe("com.acme.auth");
    expect(result.hasErrors).toBe(false);
  });

  it("extracts nested types and members with public visibility", async () => {
    const result = await parseOk("java", authService);
    expect(symbolRows(result)).toEqual([
      { name: "AuthService", kind: "class", lines: [10, 38], exported: true },
      {
        name: "AuthService",
        kind: "method",
        lines: [14, 16],
        exported: true,
        parent: "AuthService",
      },
      { name: "login", kind: "method", lines: [18, 21], exported: true, parent: "AuthService" },
      { name: "audit", kind: "method", lines: [23, 23], exported: false, parent: "AuthService" },
      { name: "Session", kind: "class", lines: [25, 27], exported: false, parent: "AuthService" },
      { name: "close", kind: "method", lines: [26, 26], exported: false, parent: "Session" },
      { name: "Role", kind: "enum", lines: [29, 32], exported: true, parent: "AuthService" },
      { name: "isAdmin", kind: "method", lines: [31, 31], exported: true, parent: "Role" },
      {
        name: "Callback",
        kind: "interface",
        lines: [34, 37],
        exported: false,
        parent: "AuthService",
      },
      { name: "call", kind: "method", lines: [35, 35], exported: true, parent: "Callback" },
      { name: "helper", kind: "method", lines: [36, 36], exported: false, parent: "Callback" },
      { name: "Point", kind: "class", lines: [40, 44], exported: false },
      { name: "Point", kind: "method", lines: [41, 43], exported: false, parent: "Point" },
      { name: "Audited", kind: "interface", lines: [46, 46], exported: false },
      { name: "Shape", kind: "class", lines: [48, 50], exported: false },
      { name: "area", kind: "method", lines: [49, 49], exported: false, parent: "Shape" },
    ]);
    expect(result.exports).toEqual(["AuthService"]);
  });

  it("skips annotations in signatures", async () => {
    const result = await parseOk("java", authService);
    expect(signatureOf(result, "AuthService")).toBe(
      "public final class AuthService<T extends User> extends Base implements Api",
    );
    expect(signatureOf(result, "login")).toBe(
      "public <R> List<R> login(String user) throws AuthException",
    );
    expect(signatureOf(result, "area")).toBe("abstract double area()");
    expect(signatureOf(result, "Audited")).toBe("@interface Audited");
  });

  it("maps imports to classes and packages", async () => {
    const result = await parseOk("java", authService);
    expect(result.imports).toEqual([
      { specifier: "java.util.List", kind: "import", line: 3, names: ["List"] },
      { specifier: "java.util.concurrent.*", kind: "import", line: 4, names: ["*"] },
      { specifier: "org.junit.Assert", kind: "import", line: 5, names: ["assertEquals"] },
      { specifier: "org.junit.Assert", kind: "import", line: 6, names: ["*"] },
      {
        specifier: "java.util.concurrent.TimeUnit",
        kind: "import",
        line: 7,
        names: ["SECONDS"],
      },
      { specifier: "com.acme.Outer.Nested", kind: "import", line: 8, names: ["Nested"] },
    ]);
  });

  it("handles files without a package", async () => {
    const result = await parseOk(
      "java",
      source("class Main { public static void main(String[] a) {} }"),
    );
    expect(result.packageName).toBeUndefined();
    expect(symbolRows(result)).toEqual([
      { name: "Main", kind: "class", lines: [1, 1], exported: false },
      { name: "main", kind: "method", lines: [1, 1], exported: true, parent: "Main" },
    ]);
  });
});
