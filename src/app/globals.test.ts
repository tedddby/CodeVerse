import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/postcss";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * The global stylesheet compiled the way `next build` compiles it: Tailwind's
 * PostCSS plugin with optimization (Lightning CSS minification). Both
 * regressions guarded here only show up in the minified production output.
 */

/** The subset of PostCSS's AST that the assertions read. */
interface CssNode {
  type: string;
  parent?: CssNode;
  name?: string;
  params?: string;
  selector?: string;
  prop?: string;
  nodes?: CssNode[];
}

type PostCss = (plugins: unknown[]) => {
  process(css: string, options: { from: string }): Promise<{ root: CssNode }>;
};

interface CompiledRule {
  selector: string;
  /** Enclosing at-rules, outermost first, e.g. `["@layer base"]`. */
  context: string[];
  props: string[];
}

const GLOBALS_PATH = fileURLToPath(new URL("./globals.css", import.meta.url));
const TAILWIND_IMPORT = '@import "tailwindcss";';
/** Utilities that explorer components use to adapt the global focus ring. */
const FOCUS_UTILITIES = "outline-none focus-visible:outline-offset-[-3px]";

// PostCSS is Tailwind's own dependency; load the copy the plugin runs with.
const requireFromHere = createRequire(import.meta.url);
const postcss = createRequire(requireFromHere.resolve("@tailwindcss/postcss"))(
  "postcss",
) as PostCss;

async function compileGlobals(): Promise<CompiledRule[]> {
  const source = readFileSync(GLOBALS_PATH, "utf8");
  expect(source).toContain(TAILWIND_IMPORT);
  // Skip scanning the project for class names; generate just the utilities under test.
  const css = source.replace(
    TAILWIND_IMPORT,
    `@import "tailwindcss" source(none);\n@source inline("${FOCUS_UTILITIES}");`,
  );
  const { root } = await postcss([tailwindcss({ optimize: true })]).process(css, {
    from: GLOBALS_PATH,
  });

  const rules: CompiledRule[] = [];
  const visit = (node: CssNode, context: string[]) => {
    if (node.type === "rule" && node.selector !== undefined) {
      const props = (node.nodes ?? []).flatMap((child) =>
        child.type === "decl" && child.prop ? [child.prop] : [],
      );
      rules.push({ selector: node.selector, context, props });
      return;
    }
    const inner =
      node.type === "atrule"
        ? [...context, `@${node.name ?? ""} ${node.params ?? ""}`.trim()]
        : context;
    for (const child of node.nodes ?? []) visit(child, inner);
  };
  visit(root, []);
  return rules;
}

let rules: CompiledRule[] = [];

beforeAll(async () => {
  rules = await compileGlobals();
});

const rulesFor = (selector: string) => rules.filter((rule) => rule.selector === selector);

describe("globals.css production output", () => {
  it("keeps the standard backdrop-filter on .glass next to the WebKit prefix", () => {
    const props = rulesFor(".glass").flatMap((rule) => rule.props);
    // Chromium and Firefox only support the unprefixed property.
    expect(props).toContain("backdrop-filter");
    expect(props).toContain("-webkit-backdrop-filter");
  });

  it("puts the global focus ring in the base layer so utilities can adapt it", () => {
    const ring = rulesFor(":focus-visible");
    expect(ring.length).toBeGreaterThan(0);
    for (const rule of ring) {
      expect(rule.context).toEqual(["@layer base"]);
      expect(rule.props).toEqual(expect.arrayContaining(["outline", "outline-offset"]));
    }

    const utilities = [".outline-none", ".focus-visible\\:outline-offset-\\[-3px\\]:focus-visible"];
    for (const selector of utilities) {
      const [rule] = rulesFor(selector);
      expect(rule?.context).toEqual(["@layer utilities"]);
    }
  });

  it("declares the base layer before the utilities layer", () => {
    const order: string[] = [];
    for (const { context } of rules) {
      const layer = context.find((entry) => entry.startsWith("@layer "));
      if (layer && !order.includes(layer)) order.push(layer);
    }
    const base = order.indexOf("@layer base");
    expect(base).toBeGreaterThanOrEqual(0);
    expect(base).toBeLessThan(order.indexOf("@layer utilities"));
  });
});
