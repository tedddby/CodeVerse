import { parseOk, signatureOf, source, symbolRows } from "@/parser/test-helpers";

describe("Rust extraction", () => {
  const library = source(
    "use std::collections::HashMap;", // 1
    "use crate::auth::{jwt, session::{Session, Token as T}, self};", // 2
    "use super::*;", // 3
    "use serde::Deserialize as De;", // 4
    "pub use self::errors::{AuthError, Result as AuthResult};", // 5
    "use ::std::fmt;", // 6
    "extern crate alloc;", // 7
    "mod models;", // 8
    "pub mod api {", // 9
    "    mod handlers;", // 10
    "    pub fn route() {}", // 11
    "}", // 12
    "", // 13
    "#[derive(Debug, Clone)]", // 14
    "pub struct Config<T> {", // 15
    "    pub name: String,", // 16
    "    value: T,", // 17
    "}", // 18
    "", // 19
    "pub(crate) struct Pair(i32, i32);", // 20
    "union Bits { int: u32, float: f32 }", // 21
    "pub enum State { On, Off }", // 22
    "", // 23
    "pub trait Greeter {", // 24
    "    const GREETING: &'static str;", // 25
    "    fn greet(&self) -> String;", // 26
    "    fn shout(&self) -> String { self.greet().to_uppercase() }", // 27
    "}", // 28
    "", // 29
    "pub type Map<V> = HashMap<String, V>;", // 30
    "pub const MAX: usize = 10;", // 31
    "static mut COUNTER: u32 = 0;", // 32
    "", // 33
    "impl<T: Clone> Config<T> {", // 34
    '    pub const DEFAULT_NAME: &\'static str = "config";', // 35
    "    pub fn new(value: T) -> Self {", // 36
    "        use std::mem;", // 37
    "        Self { name: String::new(), value }", // 38
    "    }", // 39
    "    fn helper(&self) {}", // 40
    "}", // 41
    "", // 42
    "impl Greeter for Config<String> {", // 43
    '    const GREETING: &\'static str = "hi";', // 44
    "    fn greet(&self) -> String { self.name.clone() }", // 45
    "}", // 46
    "", // 47
    "impl External { fn orphan() {} }", // 48
    "", // 49
    "pub async unsafe fn run() {}", // 50
  );

  it("expands use trees into full paths", async () => {
    const result = await parseOk("rust", library);
    expect(result.imports).toEqual([
      { specifier: "std::collections::HashMap", kind: "import", line: 1, names: ["HashMap"] },
      { specifier: "crate::auth::jwt", kind: "import", line: 2, names: ["jwt"] },
      {
        specifier: "crate::auth::session::Session",
        kind: "import",
        line: 2,
        names: ["Session"],
      },
      { specifier: "crate::auth::session::Token", kind: "import", line: 2, names: ["Token"] },
      { specifier: "crate::auth", kind: "import", line: 2, names: ["auth"] },
      { specifier: "super::*", kind: "import", line: 3, names: ["*"] },
      { specifier: "serde::Deserialize", kind: "import", line: 4, names: ["Deserialize"] },
      { specifier: "self::errors::AuthError", kind: "import", line: 5, names: ["AuthError"] },
      { specifier: "self::errors::Result", kind: "import", line: 5, names: ["Result"] },
      { specifier: "std::fmt", kind: "import", line: 6, names: ["fmt"] },
      { specifier: "alloc", kind: "import", line: 7 },
      { specifier: "models", kind: "module", line: 8 },
      { specifier: "api::handlers", kind: "module", line: 10 },
      { specifier: "std::mem", kind: "import", line: 37, names: ["mem"] },
    ]);
  });

  it("extracts items, impl methods and trait members with parents", async () => {
    const result = await parseOk("rust", library);
    expect(result.hasErrors).toBe(false);
    expect(symbolRows(result)).toEqual([
      { name: "api", kind: "module", lines: [9, 12], exported: true },
      { name: "route", kind: "function", lines: [11, 11], exported: true, parent: "api" },
      { name: "Config", kind: "struct", lines: [15, 18], exported: true },
      { name: "Pair", kind: "struct", lines: [20, 20], exported: true },
      { name: "Bits", kind: "struct", lines: [21, 21], exported: false },
      { name: "State", kind: "enum", lines: [22, 22], exported: true },
      { name: "Greeter", kind: "trait", lines: [24, 28], exported: true },
      { name: "GREETING", kind: "constant", lines: [25, 25], exported: true, parent: "Greeter" },
      { name: "greet", kind: "method", lines: [26, 26], exported: true, parent: "Greeter" },
      { name: "shout", kind: "method", lines: [27, 27], exported: true, parent: "Greeter" },
      { name: "Map", kind: "type", lines: [30, 30], exported: true },
      { name: "MAX", kind: "constant", lines: [31, 31], exported: true },
      { name: "COUNTER", kind: "constant", lines: [32, 32], exported: false },
      {
        name: "DEFAULT_NAME",
        kind: "constant",
        lines: [35, 35],
        exported: true,
        parent: "Config",
      },
      { name: "new", kind: "method", lines: [36, 39], exported: true, parent: "Config" },
      { name: "helper", kind: "method", lines: [40, 40], exported: false, parent: "Config" },
      { name: "GREETING", kind: "constant", lines: [44, 44], exported: true, parent: "Config" },
      { name: "greet", kind: "method", lines: [45, 45], exported: true, parent: "Config" },
      { name: "orphan", kind: "method", lines: [48, 48], exported: false },
      { name: "run", kind: "function", lines: [50, 50], exported: true },
    ]);
    expect(result.exports).toEqual([
      "api",
      "Config",
      "Pair",
      "State",
      "Greeter",
      "Map",
      "MAX",
      "run",
      "AuthError",
      "AuthResult",
    ]);
  });

  it("builds Rust signatures without attributes or bodies", async () => {
    const result = await parseOk("rust", library);
    expect(signatureOf(result, "Config")).toBe("pub struct Config<T>");
    expect(signatureOf(result, "Pair")).toBe("pub(crate) struct Pair(i32, i32)");
    expect(signatureOf(result, "new")).toBe("pub fn new(value: T) -> Self");
    expect(signatureOf(result, "greet")).toBe("fn greet(&self) -> String");
    expect(signatureOf(result, "Map")).toBe("pub type Map<V>");
    expect(signatureOf(result, "MAX")).toBe("pub const MAX: usize");
    expect(signatureOf(result, "run")).toBe("pub async unsafe fn run()");
    expect(signatureOf(result, "api")).toBe("pub mod api");
  });
});
