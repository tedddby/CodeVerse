import type { FileCategory } from "@/graph/model/types";

/**
 * Languages CodeVerse can AST-parse with tree-sitter. `tsx` is a separate grammar
 * but files are reported under the "typescript" language.
 */
export type ParserLanguageId =
  "typescript" | "tsx" | "javascript" | "python" | "java" | "go" | "rust";

export const PARSER_LANGUAGE_IDS: readonly ParserLanguageId[] = [
  "typescript",
  "tsx",
  "javascript",
  "python",
  "java",
  "go",
  "rust",
];

export interface LanguageInfo {
  id: string;
  name: string;
  /** Hex color tuned for legibility on a dark background. */
  color: string;
  extensions: readonly string[];
  /** Exact file names (case-sensitive) that identify the language, e.g. "Dockerfile". */
  filenames?: readonly string[];
  /** Default category for files of this language. */
  category: FileCategory;
}

export const UNKNOWN_LANGUAGE: LanguageInfo = {
  id: "unknown",
  name: "Other",
  color: "#6b7280",
  extensions: [],
  category: "other",
};

/**
 * Registry of recognized languages. Colors follow community conventions
 * (GitHub Linguist) but are lightened where the original is unreadable on dark UI.
 */
export const LANGUAGES: readonly LanguageInfo[] = [
  // Parseable languages
  {
    id: "typescript",
    name: "TypeScript",
    color: "#3b8eea",
    extensions: ["ts", "tsx", "mts", "cts"],
    category: "source",
  },
  {
    id: "javascript",
    name: "JavaScript",
    color: "#f1e05a",
    extensions: ["js", "jsx", "mjs", "cjs"],
    category: "source",
  },
  {
    id: "python",
    name: "Python",
    color: "#4b8bbe",
    extensions: ["py", "pyi", "pyw"],
    category: "source",
  },
  { id: "java", name: "Java", color: "#e76f00", extensions: ["java"], category: "source" },
  { id: "go", name: "Go", color: "#00add8", extensions: ["go"], category: "source" },
  { id: "rust", name: "Rust", color: "#dea584", extensions: ["rs"], category: "source" },
  // Other source languages (recognized, not parsed)
  { id: "c", name: "C", color: "#a8b9cc", extensions: ["c", "h"], category: "source" },
  {
    id: "cpp",
    name: "C++",
    color: "#f34b7d",
    extensions: ["cpp", "cc", "cxx", "hpp", "hh", "hxx", "ipp", "inl"],
    category: "source",
  },
  { id: "csharp", name: "C#", color: "#2ea043", extensions: ["cs"], category: "source" },
  {
    id: "objective-c",
    name: "Objective-C",
    color: "#438eff",
    extensions: ["m", "mm"],
    category: "source",
  },
  { id: "swift", name: "Swift", color: "#f05138", extensions: ["swift"], category: "source" },
  { id: "kotlin", name: "Kotlin", color: "#a97bff", extensions: ["kt", "kts"], category: "source" },
  { id: "scala", name: "Scala", color: "#dc322f", extensions: ["scala", "sc"], category: "source" },
  {
    id: "groovy",
    name: "Groovy",
    color: "#4298b8",
    extensions: ["groovy", "gradle"],
    category: "build",
  },
  {
    id: "ruby",
    name: "Ruby",
    color: "#e0535a",
    extensions: ["rb", "rake", "gemspec"],
    filenames: ["Gemfile", "Rakefile"],
    category: "source",
  },
  { id: "php", name: "PHP", color: "#8892bf", extensions: ["php", "phtml"], category: "source" },
  { id: "perl", name: "Perl", color: "#39a0c9", extensions: ["pl", "pm"], category: "source" },
  { id: "lua", name: "Lua", color: "#6a7fd8", extensions: ["lua"], category: "source" },
  { id: "dart", name: "Dart", color: "#00b4ab", extensions: ["dart"], category: "source" },
  { id: "elixir", name: "Elixir", color: "#a47ec8", extensions: ["ex", "exs"], category: "source" },
  {
    id: "erlang",
    name: "Erlang",
    color: "#d65a6b",
    extensions: ["erl", "hrl"],
    category: "source",
  },
  {
    id: "haskell",
    name: "Haskell",
    color: "#8f7cc4",
    extensions: ["hs", "lhs"],
    category: "source",
  },
  { id: "ocaml", name: "OCaml", color: "#ef7a08", extensions: ["ml", "mli"], category: "source" },
  {
    id: "fsharp",
    name: "F#",
    color: "#b845fc",
    extensions: ["fs", "fsi", "fsx"],
    category: "source",
  },
  {
    id: "clojure",
    name: "Clojure",
    color: "#91dc47",
    extensions: ["clj", "cljs", "cljc", "edn"],
    category: "source",
  },
  { id: "r", name: "R", color: "#4f8fdb", extensions: ["r"], category: "source" },
  { id: "julia", name: "Julia", color: "#a270ba", extensions: ["jl"], category: "source" },
  { id: "zig", name: "Zig", color: "#ec915c", extensions: ["zig"], category: "source" },
  { id: "nim", name: "Nim", color: "#ffc200", extensions: ["nim"], category: "source" },
  { id: "solidity", name: "Solidity", color: "#8a8fa8", extensions: ["sol"], category: "source" },
  { id: "vue", name: "Vue", color: "#41b883", extensions: ["vue"], category: "source" },
  { id: "svelte", name: "Svelte", color: "#ff3e00", extensions: ["svelte"], category: "source" },
  { id: "astro", name: "Astro", color: "#ff5a03", extensions: ["astro"], category: "source" },
  {
    id: "shell",
    name: "Shell",
    color: "#89e051",
    extensions: ["sh", "bash", "zsh", "fish"],
    category: "build",
  },
  {
    id: "powershell",
    name: "PowerShell",
    color: "#4c8fd6",
    extensions: ["ps1", "psm1", "psd1"],
    category: "build",
  },
  {
    id: "batch",
    name: "Batchfile",
    color: "#a3c95f",
    extensions: ["bat", "cmd"],
    category: "build",
  },
  {
    id: "assembly",
    name: "Assembly",
    color: "#9e8f7f",
    extensions: ["asm", "s"],
    category: "source",
  },
  { id: "sql", name: "SQL", color: "#e38c00", extensions: ["sql"], category: "data" },
  {
    id: "graphql",
    name: "GraphQL",
    color: "#e535ab",
    extensions: ["graphql", "gql"],
    category: "source",
  },
  {
    id: "protobuf",
    name: "Protocol Buffers",
    color: "#8fb2d8",
    extensions: ["proto"],
    category: "source",
  },
  {
    id: "wasm-text",
    name: "WebAssembly Text",
    color: "#8f7cff",
    extensions: ["wat", "wast"],
    category: "source",
  },
  // Markup & styles
  {
    id: "html",
    name: "HTML",
    color: "#e34c26",
    extensions: ["html", "htm", "xhtml"],
    category: "markup",
  },
  { id: "css", name: "CSS", color: "#8a63d2", extensions: ["css"], category: "style" },
  { id: "scss", name: "SCSS", color: "#c6538c", extensions: ["scss", "sass"], category: "style" },
  { id: "less", name: "Less", color: "#6d7fc0", extensions: ["less"], category: "style" },
  {
    id: "xml",
    name: "XML",
    color: "#0aa0d8",
    extensions: ["xml", "xsd", "xsl", "plist"],
    category: "markup",
  },
  { id: "svg", name: "SVG", color: "#ffb13b", extensions: ["svg"], category: "asset" },
  // Docs
  {
    id: "markdown",
    name: "Markdown",
    color: "#6b8cff",
    extensions: ["md", "mdx", "markdown"],
    category: "docs",
  },
  { id: "rst", name: "reStructuredText", color: "#8fa3c8", extensions: ["rst"], category: "docs" },
  {
    id: "text",
    name: "Text",
    color: "#9ca3af",
    extensions: ["txt"],
    filenames: ["LICENSE", "AUTHORS", "CODEOWNERS", "NOTICE"],
    category: "docs",
  },
  // Data & config
  {
    id: "json",
    name: "JSON",
    color: "#c9c94a",
    extensions: ["json", "jsonc", "json5"],
    category: "config",
  },
  { id: "yaml", name: "YAML", color: "#e4575f", extensions: ["yml", "yaml"], category: "config" },
  { id: "toml", name: "TOML", color: "#c9785a", extensions: ["toml"], category: "config" },
  {
    id: "ini",
    name: "INI",
    color: "#b0b86a",
    extensions: ["ini", "cfg", "conf", "properties", "env"],
    category: "config",
  },
  { id: "csv", name: "CSV", color: "#6fbf73", extensions: ["csv", "tsv"], category: "data" },
  {
    id: "dockerfile",
    name: "Dockerfile",
    color: "#5d8aa8",
    extensions: ["dockerfile"],
    filenames: ["Dockerfile", "Containerfile"],
    category: "build",
  },
  {
    id: "makefile",
    name: "Makefile",
    color: "#6ea84c",
    extensions: ["mk", "mak"],
    filenames: ["Makefile", "GNUmakefile", "makefile"],
    category: "build",
  },
  {
    id: "cmake",
    name: "CMake",
    color: "#4fb4d8",
    extensions: ["cmake"],
    filenames: ["CMakeLists.txt"],
    category: "build",
  },
  { id: "nix", name: "Nix", color: "#7e7eff", extensions: ["nix"], category: "build" },
  {
    id: "terraform",
    name: "HCL",
    color: "#9b7fe6",
    extensions: ["tf", "tfvars", "hcl"],
    category: "config",
  },
];

/** Extensions that are always treated as binary (never downloaded or parsed). */
export const BINARY_EXTENSIONS: ReadonlySet<string> = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "avif",
  "ico",
  "icns",
  "bmp",
  "tif",
  "tiff",
  "psd",
  "ai",
  "sketch",
  "fig",
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "key",
  "numbers",
  "pages",
  "zip",
  "gz",
  "tgz",
  "bz2",
  "xz",
  "7z",
  "rar",
  "tar",
  "zst",
  "lz4",
  "br",
  "jar",
  "war",
  "ear",
  "class",
  "dex",
  "apk",
  "aab",
  "ipa",
  "so",
  "dll",
  "exe",
  "dylib",
  "a",
  "lib",
  "o",
  "obj",
  "pdb",
  "bin",
  "dat",
  "img",
  "iso",
  "dmg",
  "msi",
  "deb",
  "rpm",
  "wasm",
  "node",
  "pyc",
  "pyo",
  "pyd",
  "whl",
  "egg",
  "lockb",
  "rlib",
  "woff",
  "woff2",
  "ttf",
  "otf",
  "eot",
  "mp3",
  "mp4",
  "m4a",
  "wav",
  "ogg",
  "oga",
  "flac",
  "aac",
  "webm",
  "mov",
  "avi",
  "mkv",
  "wmv",
  "flv",
  "sqlite",
  "sqlite3",
  "db",
  "mdb",
  "parquet",
  "avro",
  "orc",
  "npy",
  "npz",
  "pkl",
  "pickle",
  "h5",
  "hdf5",
  "onnx",
  "pt",
  "pth",
  "ckpt",
  "safetensors",
  "tflite",
  "glb",
  "gltf",
  "fbx",
  "blend",
  "stl",
  "3ds",
  "dae",
  "ktx2",
  "hdr",
  "exr",
  "swf",
  "jks",
  "keystore",
  "p12",
  "pfx",
  "der",
  "cer",
]);

const byExtension = new Map<string, LanguageInfo>();
const byFilename = new Map<string, LanguageInfo>();
const byId = new Map<string, LanguageInfo>();
for (const language of LANGUAGES) {
  byId.set(language.id, language);
  for (const ext of language.extensions) if (!byExtension.has(ext)) byExtension.set(ext, language);
  for (const name of language.filenames ?? []) byFilename.set(name, language);
}

export function getLanguage(id: string): LanguageInfo {
  return byId.get(id) ?? UNKNOWN_LANGUAGE;
}

export function getLanguageColor(id: string): string {
  return getLanguage(id).color;
}

function splitPath(path: string): { name: string; extension: string } {
  const slash = path.lastIndexOf("/");
  const name = slash === -1 ? path : path.slice(slash + 1);
  const dot = name.lastIndexOf(".");
  const extension = dot <= 0 || dot === name.length - 1 ? "" : name.slice(dot + 1).toLowerCase();
  return { name, extension };
}

/** Detects the display language of a path. Never throws; returns UNKNOWN_LANGUAGE when unrecognized. */
export function detectLanguage(path: string): LanguageInfo {
  const { name, extension } = splitPath(path);
  const exact = byFilename.get(name);
  if (exact) return exact;
  if (name.toLowerCase().startsWith("dockerfile"))
    return byId.get("dockerfile") ?? UNKNOWN_LANGUAGE;
  if (extension) {
    const match = byExtension.get(extension);
    if (match) return match;
  }
  return UNKNOWN_LANGUAGE;
}

/** Returns the tree-sitter grammar to use for a path, or null when the file cannot be parsed. */
export function parserLanguageFor(path: string): ParserLanguageId | null {
  const { extension } = splitPath(path);
  switch (extension) {
    case "ts":
    case "mts":
    case "cts":
      return "typescript";
    case "tsx":
      return "tsx";
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return "javascript";
    case "py":
    case "pyi":
    case "pyw":
      return "python";
    case "java":
      return "java";
    case "go":
      return "go";
    case "rs":
      return "rust";
    default:
      return null;
  }
}

/** Whether a display language id has a tree-sitter parser. */
export function isParseableLanguage(languageId: string): boolean {
  return ["typescript", "javascript", "python", "java", "go", "rust"].includes(languageId);
}

export function isBinaryPath(path: string): boolean {
  const { extension } = splitPath(path);
  return extension !== "" && BINARY_EXTENSIONS.has(extension);
}

const LOCKFILES = new Set([
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "Cargo.lock",
  "go.sum",
  "poetry.lock",
  "Pipfile.lock",
  "uv.lock",
  "composer.lock",
  "Gemfile.lock",
  "mix.lock",
  "pubspec.lock",
  "Package.resolved",
  "flake.lock",
  "gradle.lockfile",
]);

const VENDOR_SEGMENTS = new Set([
  "node_modules",
  "vendor",
  "vendors",
  "third_party",
  "third-party",
  "thirdparty",
  "external",
  "externals",
  "bower_components",
  "jspm_packages",
  ".yarn",
  "Pods",
  "Carthage",
  "site-packages",
  ".venv",
  "venv",
]);

const BUILD_SEGMENTS = new Set([
  "dist",
  "build",
  "out",
  "target",
  ".next",
  ".nuxt",
  "coverage",
  "__generated__",
  "generated",
  "gen",
]);

const TEST_SEGMENTS = new Set([
  "test",
  "tests",
  "__tests__",
  "spec",
  "specs",
  "__mocks__",
  "testing",
  "testdata",
  "fixtures",
  "__fixtures__",
  "e2e",
]);

const DOCS_SEGMENTS = new Set(["docs", "doc", "documentation", "website", "site"]);

/** Heuristic: lockfiles, minified bundles, source maps, vendored or generated output. */
export function isGeneratedPath(path: string): boolean {
  const { name } = splitPath(path);
  if (LOCKFILES.has(name)) return true;
  if (/\.min\.(js|css|mjs)$/i.test(name)) return true;
  if (/\.(map|snap)$/i.test(name)) return true;
  if (/(^|[._-])(generated|pb|pb2|g)\.(go|py|ts|js|java|rs|cs)$/i.test(name)) return true;
  if (/_pb2(_grpc)?\.py$/.test(name)) return true;
  const segments = path.split("/");
  segments.pop();
  return segments.some((segment) => VENDOR_SEGMENTS.has(segment));
}

/** Classifies a file into a broad category using its path and language. */
export function detectCategory(
  path: string,
  language: LanguageInfo = detectLanguage(path),
): FileCategory {
  const { name } = splitPath(path);
  const lowerName = name.toLowerCase();
  const segments = path.split("/");
  segments.pop();

  if (segments.some((segment) => VENDOR_SEGMENTS.has(segment))) return "vendor";
  if (isBinaryPath(path)) return "asset";
  if (
    /\.(test|spec|e2e|stories)\.[a-z0-9]+$/i.test(name) ||
    /^test_.*\.py$/.test(name) ||
    /_test\.(go|py|rs|exs?)$/.test(name) ||
    /(Test|Tests|IT)\.(java|kt|cs)$/.test(name) ||
    segments.some((segment) => TEST_SEGMENTS.has(segment))
  ) {
    return "test";
  }
  if (segments.some((segment) => BUILD_SEGMENTS.has(segment))) return "build";
  if (
    language.category === "source" ||
    language.category === "style" ||
    language.category === "markup"
  ) {
    if (segments.some((segment) => DOCS_SEGMENTS.has(segment)) && language.category !== "source")
      return "docs";
    return language.category;
  }
  if (
    language.id === "markdown" ||
    language.id === "rst" ||
    lowerName.startsWith("readme") ||
    lowerName.startsWith("changelog")
  ) {
    return "docs";
  }
  if (
    lowerName.startsWith(".") ||
    /\.config\.[a-z]+$/.test(lowerName) ||
    /rc(\.[a-z]+)?$/.test(lowerName)
  ) {
    return "config";
  }
  return language.category;
}
