type ClassValue = string | false | null | undefined | 0;

/**
 * Joins truthy class names; when two classes set the same property under the
 * same variants, the later one wins (a `className` override beats the base).
 *
 * Tailwind emits utilities in its own order, not in class-list order, so
 * without this a base `inline-flex` beats an override `hidden`. Only groups
 * whose members are unambiguous by name are merged (display, position and
 * width/height with their min/max); every other class is kept as written.
 */
export function cn(...classes: ClassValue[]): string {
  const tokens = classes.filter(Boolean).join(" ").split(/\s+/);
  const seen = new Set<string>();
  const kept: string[] = [];
  for (let position = tokens.length - 1; position >= 0; position -= 1) {
    const token = tokens[position];
    if (!token) continue;
    const key = conflictKey(token);
    if (key !== null) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    kept.push(token);
  }
  return kept.reverse().join(" ");
}

const DISPLAY = new Set([
  "block",
  "inline-block",
  "inline",
  "flex",
  "inline-flex",
  "grid",
  "inline-grid",
  "table",
  "inline-table",
  "table-caption",
  "table-cell",
  "table-column",
  "table-column-group",
  "table-footer-group",
  "table-header-group",
  "table-row-group",
  "table-row",
  "flow-root",
  "contents",
  "list-item",
  "hidden",
]);

const POSITION = new Set(["static", "fixed", "absolute", "relative", "sticky"]);

/** Longest prefixes first: `min-w-` must not be read as `w-`. */
const SIZE_PREFIXES = ["min-w-", "max-w-", "min-h-", "max-h-", "w-", "h-"] as const;

function utilityGroup(utility: string): string | null {
  if (DISPLAY.has(utility)) return "display";
  if (POSITION.has(utility)) return "position";
  return SIZE_PREFIXES.find((prefix) => utility.startsWith(prefix)) ?? null;
}

/** "md:hover:max-h-[calc(1rem)]" -> "md:hover:max-h-"; null when the class is not merged. */
function conflictKey(token: string): string | null {
  // Variants are separated by colons outside brackets (arbitrary values may contain colons).
  let depth = 0;
  let utilityStart = 0;
  for (let position = 0; position < token.length; position += 1) {
    const char = token[position];
    if (char === "[" || char === "(") depth += 1;
    else if ((char === "]" || char === ")") && depth > 0) depth -= 1;
    else if (char === ":" && depth === 0) utilityStart = position + 1;
  }
  let utility = token.slice(utilityStart);
  // Important modifier: leading (v3) or trailing (v4) "!"; important classes only conflict with each other.
  const important = utility.startsWith("!") || utility.endsWith("!");
  if (important) utility = utility.replace(/^!|!$/g, "");
  const group = utilityGroup(utility);
  return group === null ? null : `${token.slice(0, utilityStart)}${important ? "!" : ""}${group}`;
}
