import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const srcDirectory = path.join(process.cwd(), "src");

/** Runtime (non type-only) import/export specifiers of a TypeScript module. */
function runtimeSpecifiers(code: string): string[] {
  const specifiers: string[] = [];
  const fromClause = /^\s*(import|export)\s+(type\s+)?[^;]*?\sfrom\s+["']([^"']+)["']/gm;
  for (const match of code.matchAll(fromClause)) {
    if (!match[2] && match[3]) specifiers.push(match[3]);
  }
  for (const match of code.matchAll(/^\s*import\s+["']([^"']+)["']/gm)) {
    if (match[1]) specifiers.push(match[1]);
  }
  return specifiers;
}

function resolveLocal(fromFile: string, specifier: string): string | null {
  const base = specifier.startsWith("@/")
    ? path.join(srcDirectory, specifier.slice(2))
    : path.resolve(path.dirname(fromFile), specifier);
  for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Every module reachable from `entry` through runtime imports, plus external specifiers. */
function importGraph(entry: string): { files: Set<string>; external: Set<string> } {
  const files = new Set<string>();
  const external = new Set<string>();
  const pending = [entry];
  while (pending.length > 0) {
    const file = pending.pop();
    if (!file || files.has(file)) continue;
    files.add(file);
    for (const specifier of runtimeSpecifiers(readFileSync(file, "utf8"))) {
      const isLocal = specifier.startsWith(".") || specifier.startsWith("@/");
      if (!isLocal) {
        external.add(specifier);
        continue;
      }
      const resolved = resolveLocal(file, specifier);
      if (!resolved) throw new Error(`Cannot resolve ${specifier} from ${file}`);
      pending.push(resolved);
    }
  }
  return { files, external };
}

describe("@/parser entry point", () => {
  it("is environment-agnostic: no Node built-ins are reachable from index.ts", () => {
    const { files, external } = importGraph(path.join(srcDirectory, "parser", "index.ts"));
    expect(files.size).toBeGreaterThan(10);
    expect([...external].sort()).toEqual(["web-tree-sitter"]);
    const relative = [...files].map((file) =>
      path.relative(srcDirectory, file).replace(/\\/g, "/"),
    );
    expect(relative).not.toContain("parser/loaders/node-loader.ts");
    expect(relative).not.toContain("parser/node.ts");
  });

  it("keeps Node-specific code behind @/parser/node", () => {
    const { external } = importGraph(path.join(srcDirectory, "parser", "node.ts"));
    expect(external).toContain("node:fs/promises");
  });
});
