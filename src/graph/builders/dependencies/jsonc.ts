/**
 * Tolerant JSON-with-comments parsing for tsconfig.json / jsconfig.json /
 * package.json files. Strips line and block comments and trailing commas
 * (outside strings), then defers to JSON.parse. Never throws.
 */

function stripComments(text: string): string {
  let output = "";
  let index = 0;
  let inString = false;
  while (index < text.length) {
    const char = text[index];
    const next = text[index + 1];
    if (inString) {
      output += char;
      if (char === "\\" && next !== undefined) {
        output += next;
        index += 2;
        continue;
      }
      if (char === '"') inString = false;
      index += 1;
      continue;
    }
    if (char === '"') {
      inString = true;
      output += char;
      index += 1;
    } else if (char === "/" && next === "/") {
      while (index < text.length && text[index] !== "\n") index += 1;
    } else if (char === "/" && next === "*") {
      const end = text.indexOf("*/", index + 2);
      index = end === -1 ? text.length : end + 2;
      output += " ";
    } else {
      output += char;
      index += 1;
    }
  }
  return output;
}

function stripTrailingCommas(text: string): string {
  let output = "";
  let inString = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? "";
    if (inString) {
      output += char;
      if (char === "\\") {
        output += text[index + 1] ?? "";
        index += 1;
      } else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    if (char === ",") {
      let lookahead = index + 1;
      while (lookahead < text.length && /\s/.test(text[lookahead] ?? "")) lookahead += 1;
      const following = text[lookahead];
      if (following === "}" || following === "]") continue;
    }
    output += char;
  }
  return output;
}

/** Parses JSON with comments and trailing commas. Returns undefined when the text is not valid. */
export function parseJsonc(text: string): unknown {
  const withoutBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  try {
    return JSON.parse(stripTrailingCommas(stripComments(withoutBom))) as unknown;
  } catch {
    return undefined;
  }
}

export type JsonObject = Record<string, unknown>;

/** Narrows a parsed JSON value to a plain object. */
export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads a string property of a JSON object. */
export function stringProperty(value: unknown, key: string): string | undefined {
  if (!isJsonObject(value)) return undefined;
  const property = value[key];
  return typeof property === "string" ? property : undefined;
}
