/**
 * Maps CodeVerse language-registry ids (plus the file path, for dialects that
 * share a registry id) to Shiki grammar ids. Pure and dependency-free so it can
 * be unit tested and imported without pulling Shiki into the bundle.
 */

export const SHIKI_LANGUAGE_IDS = [
  "typescript",
  "tsx",
  "javascript",
  "jsx",
  "python",
  "java",
  "go",
  "rust",
  "c",
  "cpp",
  "csharp",
  "objective-c",
  "swift",
  "kotlin",
  "scala",
  "groovy",
  "ruby",
  "php",
  "perl",
  "lua",
  "dart",
  "elixir",
  "erlang",
  "haskell",
  "ocaml",
  "fsharp",
  "clojure",
  "r",
  "julia",
  "zig",
  "nim",
  "solidity",
  "vue",
  "svelte",
  "astro",
  "shellscript",
  "powershell",
  "bat",
  "asm",
  "sql",
  "graphql",
  "proto",
  "wasm",
  "html",
  "css",
  "scss",
  "sass",
  "less",
  "xml",
  "markdown",
  "mdx",
  "rst",
  "json",
  "jsonc",
  "json5",
  "yaml",
  "toml",
  "ini",
  "dotenv",
  "properties",
  "dockerfile",
  "make",
  "cmake",
  "nix",
  "hcl",
  "terraform",
] as const;

export type ShikiLanguageId = (typeof SHIKI_LANGUAGE_IDS)[number];

/** Registry ids whose Shiki grammar has the same id. */
const SAME_ID: ReadonlySet<string> = new Set<ShikiLanguageId>([
  "python",
  "java",
  "go",
  "rust",
  "c",
  "cpp",
  "csharp",
  "objective-c",
  "swift",
  "kotlin",
  "scala",
  "groovy",
  "ruby",
  "php",
  "perl",
  "lua",
  "dart",
  "elixir",
  "erlang",
  "haskell",
  "ocaml",
  "fsharp",
  "clojure",
  "r",
  "julia",
  "zig",
  "nim",
  "solidity",
  "vue",
  "svelte",
  "astro",
  "powershell",
  "sql",
  "graphql",
  "html",
  "css",
  "less",
  "xml",
  "markdown",
  "rst",
  "yaml",
  "toml",
  "dockerfile",
  "cmake",
  "nix",
]);

/** Registry ids whose grammar differs only by name. */
const RENAMED: Readonly<Record<string, ShikiLanguageId>> = {
  shell: "shellscript",
  batch: "bat",
  assembly: "asm",
  protobuf: "proto",
  "wasm-text": "wasm",
  svg: "xml",
  makefile: "make",
};

const JSONC_FILE = /^(tsconfig|jsconfig)(\..+)?\.json$|^\.?devcontainer\.json$/;

function isSameId(languageId: string): languageId is ShikiLanguageId {
  return SAME_ID.has(languageId);
}

function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
}

function baseNameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/**
 * Returns the Shiki grammar for a file, or null for plain text (unknown
 * languages, prose, CSV...). `languageId` is the registry id stored on the FileNode.
 */
export function shikiLanguageFor(languageId: string, path: string): ShikiLanguageId | null {
  const extension = extensionOf(path);
  switch (languageId) {
    case "typescript":
      return extension === "tsx" ? "tsx" : "typescript";
    case "javascript":
      return extension === "jsx" ? "jsx" : "javascript";
    case "scss":
      return extension === "sass" ? "sass" : "scss";
    case "markdown":
      return extension === "mdx" ? "mdx" : "markdown";
    case "json":
      if (extension === "jsonc") return "jsonc";
      if (extension === "json5") return "json5";
      // Well-known JSON files that allow comments.
      return JSONC_FILE.test(baseNameOf(path)) ||
        path.startsWith(".vscode/") ||
        path.includes("/.vscode/")
        ? "jsonc"
        : "json";
    case "ini":
      if (extension === "env" || baseNameOf(path).startsWith(".env")) return "dotenv";
      if (extension === "properties") return "properties";
      return "ini";
    case "terraform":
      return extension === "hcl" ? "hcl" : "terraform";
    default:
      break;
  }
  if (isSameId(languageId)) return languageId;
  const renamed = RENAMED[languageId];
  if (renamed) return renamed;
  // Files the registry could not classify but whose name is unambiguous.
  if (languageId === "unknown" && baseNameOf(path).startsWith(".env")) return "dotenv";
  return null;
}
