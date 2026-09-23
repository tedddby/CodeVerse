import { parseOk, signatureOf, source, symbolRows } from "@/parser/test-helpers";

describe("Python extraction", () => {
  const service = source(
    '"""Authentication service."""', // 1
    "from __future__ import annotations", // 2
    "import os.path, sys as system", // 3
    "from typing import TYPE_CHECKING, Optional", // 4
    "from .models import User, Group as UserGroup", // 5
    "from . import utils", // 6
    "from ..core import *", // 7
    "from .. import settings", // 8
    "", // 9
    "MAX_RETRIES: int = 3", // 10
    "DEFAULT_ROLE = 'user'", // 11
    "_CACHE_SIZE = 128", // 12
    "logger = get_logger()", // 13
    "", // 14
    "if TYPE_CHECKING:", // 15
    "    from .session import Session", // 16
    "", // 17
    "", // 18
    "@dataclass(frozen=True)", // 19
    "class Credentials:", // 20
    "    user: str", // 21
    "    password: str", // 22
    "", // 23
    "", // 24
    "class AuthService(BaseService):", // 25
    '    """Issues tokens."""', // 26
    "", // 27
    "    def __init__(self, secret: str) -> None:", // 28
    "        self._secret = secret", // 29
    "", // 30
    "    @property", // 31
    "    def name(self) -> str:", // 32
    "        return 'auth'", // 33
    "", // 34
    "    async def login(self, credentials: Credentials) -> Optional[User]:", // 35
    "        import hashlib", // 36
    "        def digest(value):", // 37
    "            return hashlib.sha256(value).hexdigest()", // 38
    "        return None", // 39
    "", // 40
    "    def _audit(self):", // 41
    "        pass", // 42
    "", // 43
    "    class Meta:", // 44
    "        table = 'auth'", // 45
    "", // 46
    "", // 47
    "def authenticate(token: str) -> bool:", // 48
    "    return bool(token)", // 49
    "", // 50
    "", // 51
    "def _helper():", // 52
    "    pass", // 53
  );

  it("extracts classes, methods, functions and constants with nesting", async () => {
    const result = await parseOk("python", service);
    expect(result.hasErrors).toBe(false);
    expect(symbolRows(result)).toEqual([
      { name: "MAX_RETRIES", kind: "constant", lines: [10, 10], exported: true },
      { name: "DEFAULT_ROLE", kind: "constant", lines: [11, 11], exported: true },
      { name: "_CACHE_SIZE", kind: "constant", lines: [12, 12], exported: false },
      { name: "Credentials", kind: "class", lines: [19, 22], exported: true },
      { name: "AuthService", kind: "class", lines: [25, 45], exported: true },
      {
        name: "__init__",
        kind: "method",
        lines: [28, 29],
        exported: true,
        parent: "AuthService",
      },
      { name: "name", kind: "method", lines: [31, 33], exported: true, parent: "AuthService" },
      { name: "login", kind: "method", lines: [35, 39], exported: true, parent: "AuthService" },
      { name: "_audit", kind: "method", lines: [41, 42], exported: false, parent: "AuthService" },
      { name: "Meta", kind: "class", lines: [44, 45], exported: true, parent: "AuthService" },
      { name: "authenticate", kind: "function", lines: [48, 49], exported: true },
      { name: "_helper", kind: "function", lines: [52, 53], exported: false },
    ]);
    expect(result.exports).toEqual([
      "MAX_RETRIES",
      "DEFAULT_ROLE",
      "Credentials",
      "AuthService",
      "authenticate",
    ]);
  });

  it("builds signatures without the trailing colon or values", async () => {
    const result = await parseOk("python", service);
    expect(signatureOf(result, "login")).toBe(
      "async def login(self, credentials: Credentials) -> Optional[User]",
    );
    expect(signatureOf(result, "AuthService")).toBe("class AuthService(BaseService)");
    expect(signatureOf(result, "Credentials")).toBe("class Credentials");
    expect(signatureOf(result, "MAX_RETRIES")).toBe("MAX_RETRIES: int");
    expect(signatureOf(result, "DEFAULT_ROLE")).toBe("DEFAULT_ROLE");
  });

  it("extracts absolute, relative, wildcard and nested imports (skipping __future__)", async () => {
    const result = await parseOk("python", service);
    expect(result.imports).toEqual([
      { specifier: "os.path", kind: "import", line: 3 },
      { specifier: "sys", kind: "import", line: 3 },
      { specifier: "typing", kind: "import", line: 4, names: ["TYPE_CHECKING", "Optional"] },
      { specifier: ".models", kind: "import", line: 5, names: ["User", "Group"] },
      { specifier: ".", kind: "import", line: 6, names: ["utils"] },
      { specifier: "..core", kind: "import", line: 7, names: ["*"] },
      { specifier: "..", kind: "import", line: 8, names: ["settings"] },
      { specifier: ".session", kind: "import", line: 16, names: ["Session"] },
      { specifier: "hashlib", kind: "import", line: 36 },
    ]);
  });

  it("uses __all__ as the export list when present", async () => {
    const result = await parseOk(
      "python",
      source(
        "from .client import Client", // 1
        "__all__ = ['Client', 'connect']", // 2
        "__all__ += ('VERSION',)", // 3
        "VERSION = '2.0'", // 4
        "TIMEOUT = 30", // 5
        "def connect(url):", // 6
        "    return Client(url)", // 7
        "def disconnect():", // 8
        "    pass", // 9
        "class _Pool:", // 10
        "    def acquire(self): pass", // 11
      ),
    );
    expect(result.exports).toEqual(["Client", "connect", "VERSION"]);
    expect(symbolRows(result)).toEqual([
      { name: "VERSION", kind: "constant", lines: [4, 4], exported: true },
      { name: "TIMEOUT", kind: "constant", lines: [5, 5], exported: false },
      { name: "connect", kind: "function", lines: [6, 7], exported: true },
      { name: "disconnect", kind: "function", lines: [8, 9], exported: false },
      { name: "_Pool", kind: "class", lines: [10, 11], exported: false },
      { name: "acquire", kind: "method", lines: [11, 11], exported: false, parent: "_Pool" },
    ]);
  });

  it("keeps conditional definitions and type aliases", async () => {
    const result = await parseOk(
      "python",
      source(
        "try:", // 1
        "    import ujson as json", // 2
        "except ImportError:", // 3
        "    import json", // 4
        "    def dumps(value): return json.dumps(value)", // 5
        "if sys.version_info >= (3, 12):", // 6
        "    type Vector = list[float]", // 7
        "else:", // 8
        "    Vector = list", // 9
        "A, B = 1, 2", // 10
      ),
    );
    expect(result.imports.map((entry) => [entry.specifier, entry.line])).toEqual([
      ["ujson", 2],
      ["json", 4],
    ]);
    expect(symbolRows(result)).toEqual([
      { name: "dumps", kind: "function", lines: [5, 5], exported: true },
      { name: "Vector", kind: "type", lines: [7, 7], exported: true },
      { name: "A", kind: "constant", lines: [10, 10], exported: true },
      { name: "B", kind: "constant", lines: [10, 10], exported: true },
    ]);
  });

  it("extracts Python 3.12 type alias statements at module level", async () => {
    const result = await parseOk("python", source("type Pair[T] = tuple[T, T]", "type _Id = int"));
    expect(symbolRows(result)).toEqual([
      { name: "Pair", kind: "type", lines: [1, 1], exported: true },
      { name: "_Id", kind: "type", lines: [2, 2], exported: false },
    ]);
    expect(signatureOf(result, "Pair")).toBe("type Pair[T]");
  });
});
