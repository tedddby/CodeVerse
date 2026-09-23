/**
 * Tolerant TOML subset parser for Cargo.toml and pyproject.toml.
 *
 * Supports tables, arrays of tables, dotted and quoted keys, basic/literal
 * (single- and multi-line) strings, numbers, booleans, dates (kept as strings),
 * multi-line arrays and inline tables. Malformed lines are skipped instead of
 * failing the whole document: resolution degrades gracefully on odd manifests.
 * Objects are created without a prototype so keys like "__proto__" are inert.
 */

export type TomlTable = Record<string, unknown>;

function createTable(): TomlTable {
  return Object.create(null) as TomlTable;
}

export function isTomlTable(value: unknown): value is TomlTable {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

class TomlSyntaxError extends Error {}

class Cursor {
  index = 0;
  constructor(readonly text: string) {}

  peek(offset = 0): string {
    return this.text[this.index + offset] ?? "";
  }

  startsWith(token: string): boolean {
    return this.text.startsWith(token, this.index);
  }

  get done(): boolean {
    return this.index >= this.text.length;
  }

  /** Skips spaces and tabs (not newlines). */
  skipInline(): void {
    while (this.peek() === " " || this.peek() === "\t") this.index += 1;
  }

  /** Skips whitespace, newlines and comments. */
  skipAll(): void {
    for (;;) {
      const char = this.peek();
      if (char === " " || char === "\t" || char === "\r" || char === "\n") this.index += 1;
      else if (char === "#") this.skipLine();
      else return;
    }
  }

  skipLine(): void {
    while (!this.done && this.peek() !== "\n") this.index += 1;
  }

  expect(char: string): void {
    if (this.peek() !== char) throw new TomlSyntaxError(`Expected "${char}"`);
    this.index += 1;
  }
}

const ESCAPES: Readonly<Record<string, string>> = {
  b: "\b",
  t: "\t",
  n: "\n",
  f: "\f",
  r: "\r",
  '"': '"',
  "\\": "\\",
};

function readBasicString(cursor: Cursor): string {
  const multiline = cursor.startsWith('"""');
  cursor.index += multiline ? 3 : 1;
  if (multiline && cursor.peek() === "\n") cursor.index += 1;
  let value = "";
  while (!cursor.done) {
    if (multiline ? cursor.startsWith('"""') : cursor.peek() === '"') {
      cursor.index += multiline ? 3 : 1;
      return value;
    }
    const char = cursor.peek();
    if (!multiline && char === "\n") break;
    if (char === "\\") {
      const code = cursor.peek(1);
      if (code === "u" || code === "U") {
        const length = code === "u" ? 4 : 8;
        const hex = cursor.text.slice(cursor.index + 2, cursor.index + 2 + length);
        const point = Number.parseInt(hex, 16);
        value += Number.isNaN(point) || point > 0x10ffff ? "" : String.fromCodePoint(point);
        cursor.index += 2 + length;
        continue;
      }
      if (multiline && (code === "\n" || code === " " || code === "\r")) {
        cursor.index += 1;
        while (/\s/.test(cursor.peek())) cursor.index += 1;
        continue;
      }
      value += ESCAPES[code] ?? code;
      cursor.index += 2;
      continue;
    }
    value += char;
    cursor.index += 1;
  }
  throw new TomlSyntaxError("Unterminated string");
}

function readLiteralString(cursor: Cursor): string {
  const multiline = cursor.startsWith("'''");
  const delimiter = multiline ? "'''" : "'";
  cursor.index += delimiter.length;
  if (multiline && cursor.peek() === "\n") cursor.index += 1;
  const end = cursor.text.indexOf(delimiter, cursor.index);
  if (end === -1) throw new TomlSyntaxError("Unterminated string");
  const value = cursor.text.slice(cursor.index, end);
  if (!multiline && value.includes("\n")) throw new TomlSyntaxError("Unterminated string");
  cursor.index = end + delimiter.length;
  return value;
}

function readKeySegment(cursor: Cursor): string {
  const char = cursor.peek();
  if (char === '"') return readBasicString(cursor);
  if (char === "'") return readLiteralString(cursor);
  const match = /^[A-Za-z0-9_-]+/.exec(cursor.text.slice(cursor.index, cursor.index + 256));
  if (!match) throw new TomlSyntaxError("Invalid key");
  cursor.index += match[0].length;
  return match[0];
}

function readKey(cursor: Cursor): string[] {
  const segments: string[] = [];
  for (;;) {
    cursor.skipInline();
    segments.push(readKeySegment(cursor));
    cursor.skipInline();
    if (cursor.peek() !== ".") return segments;
    cursor.index += 1;
  }
}

function readScalar(cursor: Cursor): unknown {
  const match = /^[^\s,\]}#]+/.exec(cursor.text.slice(cursor.index, cursor.index + 256));
  if (!match) throw new TomlSyntaxError("Invalid value");
  cursor.index += match[0].length;
  const raw = match[0];
  if (raw === "true") return true;
  if (raw === "false") return false;
  const numeric = raw.replace(/_/g, "");
  if (/^[+-]?(\d+(\.\d+)?([eE][+-]?\d+)?|0x[0-9a-fA-F]+|0o[0-7]+|0b[01]+|inf|nan)$/.test(numeric)) {
    const value = Number(numeric.replace(/^\+/, ""));
    return Number.isNaN(value) && !/nan/.test(numeric) ? raw : value;
  }
  // Dates, times and anything unrecognized are kept as their raw text.
  return raw;
}

function readValue(cursor: Cursor, depth: number): unknown {
  if (depth > 32) throw new TomlSyntaxError("Nesting too deep");
  const char = cursor.peek();
  if (char === '"') return readBasicString(cursor);
  if (char === "'") return readLiteralString(cursor);
  if (char === "[") {
    cursor.index += 1;
    const items: unknown[] = [];
    for (;;) {
      cursor.skipAll();
      if (cursor.peek() === "]") {
        cursor.index += 1;
        return items;
      }
      items.push(readValue(cursor, depth + 1));
      cursor.skipAll();
      if (cursor.peek() === ",") cursor.index += 1;
      else if (cursor.peek() !== "]") throw new TomlSyntaxError("Invalid array");
    }
  }
  if (char === "{") {
    cursor.index += 1;
    const table = createTable();
    for (;;) {
      cursor.skipAll();
      if (cursor.peek() === "}") {
        cursor.index += 1;
        return table;
      }
      const key = readKey(cursor);
      cursor.expect("=");
      cursor.skipInline();
      assign(table, key, readValue(cursor, depth + 1));
      cursor.skipAll();
      if (cursor.peek() === ",") cursor.index += 1;
      else if (cursor.peek() !== "}") throw new TomlSyntaxError("Invalid inline table");
    }
  }
  return readScalar(cursor);
}

/** Walks (creating as needed) nested tables; the last element of an array of tables is used. */
function descend(root: TomlTable, path: readonly string[]): TomlTable {
  let table = root;
  for (const segment of path) {
    const existing = table[segment];
    if (isTomlTable(existing)) {
      table = existing;
    } else if (Array.isArray(existing) && isTomlTable(existing[existing.length - 1])) {
      table = existing[existing.length - 1] as TomlTable;
    } else if (existing === undefined) {
      const created = createTable();
      table[segment] = created;
      table = created;
    } else {
      throw new TomlSyntaxError("Key redefined");
    }
  }
  return table;
}

function assign(table: TomlTable, key: readonly string[], value: unknown): void {
  const last = key[key.length - 1];
  if (last === undefined) return;
  const parent = descend(table, key.slice(0, -1));
  if (parent[last] === undefined) parent[last] = value;
}

/** Parses a TOML document, skipping lines it cannot understand. Never throws. */
export function parseToml(text: string): TomlTable {
  const root = createTable();
  const cursor = new Cursor(text.replace(/\r\n/g, "\n"));
  let current = root;
  while (!cursor.done) {
    cursor.skipAll();
    if (cursor.done) break;
    const lineStart = cursor.index;
    try {
      if (cursor.peek() === "[") {
        const isArray = cursor.startsWith("[[");
        cursor.index += isArray ? 2 : 1;
        const key = readKey(cursor);
        cursor.expect("]");
        if (isArray) cursor.expect("]");
        if (isArray) {
          const parent = descend(root, key.slice(0, -1));
          const name = key[key.length - 1] ?? "";
          const existing = parent[name];
          const entry = createTable();
          if (Array.isArray(existing)) existing.push(entry);
          else if (existing === undefined) parent[name] = [entry];
          else throw new TomlSyntaxError("Key redefined");
          current = entry;
        } else {
          current = descend(root, key);
        }
      } else {
        const key = readKey(cursor);
        cursor.expect("=");
        cursor.skipInline();
        assign(current, key, readValue(cursor, 0));
      }
      cursor.skipInline();
      if (cursor.peek() === "#") cursor.skipLine();
      if (!cursor.done && cursor.peek() !== "\n") throw new TomlSyntaxError("Trailing characters");
    } catch (error) {
      if (!(error instanceof TomlSyntaxError)) throw error;
      // Keys below a broken table header must not leak into the previous table.
      if (cursor.text[lineStart] === "[") current = createTable();
      cursor.index = lineStart;
      cursor.skipLine();
    }
  }
  return root;
}

/** Reads a nested value by key path ("package", "name"). */
export function tomlGet(table: TomlTable, ...path: string[]): unknown {
  let value: unknown = table;
  for (const segment of path) {
    if (!isTomlTable(value)) return undefined;
    value = value[segment];
  }
  return value;
}
