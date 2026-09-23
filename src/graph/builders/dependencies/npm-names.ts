/**
 * npm package-name helpers and the Node.js core module list.
 */

/** Node.js core modules importable without the "node:" prefix (top-level names). */
const NODE_BUILTINS: ReadonlySet<string> = new Set([
  "assert",
  "async_hooks",
  "buffer",
  "child_process",
  "cluster",
  "console",
  "constants",
  "crypto",
  "dgram",
  "diagnostics_channel",
  "dns",
  "domain",
  "events",
  "fs",
  "http",
  "http2",
  "https",
  "inspector",
  "module",
  "net",
  "os",
  "path",
  "perf_hooks",
  "process",
  "punycode",
  "querystring",
  "readline",
  "repl",
  "stream",
  "string_decoder",
  "sys",
  "timers",
  "tls",
  "trace_events",
  "tty",
  "url",
  "util",
  "v8",
  "vm",
  "wasi",
  "worker_threads",
  "zlib",
]);

/**
 * Returns the normalized external name ("node:fs") when the specifier is a Node
 * core module ("node:fs/promises", "fs", "fs/promises"), else null.
 */
export function nodeBuiltinName(specifier: string): string | null {
  if (specifier.startsWith("node:")) {
    const moduleName = specifier.slice(5).split("/")[0] ?? "";
    return moduleName ? `node:${moduleName}` : null;
  }
  const topLevel = specifier.split("/")[0] ?? "";
  return NODE_BUILTINS.has(topLevel) ? `node:${topLevel}` : null;
}

/** npm name segment; a leading "~" is always a path alias ("~/components"), never a package. */
const NAME_SEGMENT = /^[a-z0-9][a-z0-9._~-]*$/i;

/**
 * Package name of a bare specifier ("@scope/pkg/sub" -> "@scope/pkg",
 * "lodash/fp" -> "lodash"), or null when the specifier cannot name an npm
 * package (aliases such as "@/x" or "~/x", subpath imports "#x", paths).
 */
export function packageNameOf(specifier: string): string | null {
  const segments = specifier.split("/");
  const first = segments[0] ?? "";
  if (first.startsWith("@")) {
    const scope = first.slice(1);
    const name = segments[1] ?? "";
    if (!NAME_SEGMENT.test(scope) || !NAME_SEGMENT.test(name)) return null;
    return `${first}/${name}`;
  }
  if (!NAME_SEGMENT.test(first)) return null;
  return first;
}

/** The part of a bare specifier after its package name ("" when importing the package root). */
export function packageSubpathOf(specifier: string, packageName: string): string {
  return specifier.length > packageName.length ? specifier.slice(packageName.length + 1) : "";
}

/**
 * External name for protocol specifiers used by Deno, Bun and bundlers:
 * "npm:react@18/jsx" -> "react", "jsr:@std/path" -> "jsr:@std/path",
 * "https://deno.land/x/y.ts" -> "deno.land", "virtual:pwa" -> "virtual:pwa".
 * Returns null for specifiers without a scheme.
 */
export function protocolExternalName(specifier: string): string | null {
  const match = /^([a-z][a-z0-9+.-]*):(.*)$/i.exec(specifier);
  if (!match) return null;
  const scheme = (match[1] ?? "").toLowerCase();
  const rest = match[2] ?? "";
  if (scheme === "http" || scheme === "https") {
    try {
      return new URL(specifier).host || null;
    } catch {
      return null;
    }
  }
  if (scheme === "npm" || scheme === "jsr") {
    const withoutVersion = rest.replace(/^(@[^/@]+\/[^/@]+|[^/@]+)@[^/]*/, "$1");
    const name = packageNameOf(withoutVersion);
    if (!name) return null;
    return scheme === "npm" ? name : `jsr:${name}`;
  }
  const head = rest.split("/")[0] ?? "";
  return head ? `${scheme}:${head}` : scheme;
}
