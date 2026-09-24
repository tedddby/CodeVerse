import type { ComponentType } from "react";
import { cn } from "@/lib/utils/cn";
import { HoverArrow } from "./hover-arrow";
import { FetchVisual, GraphVisual, ParseVisual, RenderVisual } from "./pipeline-visuals";
import { SectionHeading } from "./section-heading";
import { ANCHORS, CONTAINER, SECTION_SPACING } from "./tokens";

interface Stage {
  name: string;
  title: string;
  body: string;
  spec: string;
  Visual: ComponentType;
}

const STAGES: readonly Stage[] = [
  {
    name: "Fetch",
    title: "Read it through the GitHub API",
    body: "The tree, source files and recent history arrive over HTTPS. Nothing is cloned, installed or built, and no repository code is ever executed.",
    spec: "REST + GraphQL · byte budgets",
    Visual: FetchVisual,
  },
  {
    name: "Parse",
    title: "Build real syntax trees",
    body: "tree-sitter grammars compiled to WebAssembly parse TypeScript, JavaScript, Python, Java, Go and Rust into declarations, exports and imports.",
    spec: "web-tree-sitter · 6 grammars",
    Visual: ParseVisual,
  },
  {
    name: "Graph",
    title: "Normalize into a RepositoryGraph",
    body: "Directories, files, symbols, resolved imports, commits and contributors become one provider-agnostic model, cached per repository and commit.",
    spec: "keyed by repository@commit",
    Visual: GraphVisual,
  },
  {
    name: "Render",
    title: "Lay out and draw the world",
    body: "A deterministic layout turns directories into districts and files into buildings. Instanced WebGL draws thousands at once; detail appears up close.",
    spec: "three.js · instancing · LOD",
    Visual: RenderVisual,
  },
];

/** Dashed guides between columns: two columns on tablets, four on desktop. */
function columnClass(index: number, count: number): string {
  return cn(
    index % 2 === 1 ? "sm:border-l sm:pl-5" : "sm:pr-5",
    index > 0 && "lg:border-l lg:pl-6",
    index < count - 1 ? "lg:pr-6" : "lg:pr-0",
  );
}

/**
 * Hand-off marker on the guide between two stages, level with the panels.
 * Shown wherever the previous stage sits to the left in the same row.
 */
function StageConnector({ index }: { index: number }) {
  if (index === 0) return null;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "absolute top-[74px] -left-3 hidden size-6 items-center justify-center rounded-full bg-white text-(--lc-accent) shadow-[0_1px_2px_rgb(15_28_63/0.1)] ring-1 ring-(--lc-line-strong) lg:flex",
        index % 2 === 1 && "sm:flex",
      )}
    >
      <HoverArrow solid className="size-2.5" />
    </span>
  );
}

/** Section 2: the four-stage pipeline, left to right, with dashed column guides. */
export function HowItWorks() {
  return (
    <section
      id={ANCHORS.howItWorks}
      aria-labelledby="how-it-works-title"
      className={cn("scroll-mt-4 bg-white", SECTION_SPACING)}
    >
      <div className={CONTAINER}>
        <SectionHeading
          id="how-it-works-title"
          eyebrow="How it works"
          title="From a URL to a universe in four stages."
        >
          <p>
            Analysis runs on the server as one streamed request. Your browser receives a normalized
            graph, and source is fetched only for the files you open.
          </p>
        </SectionHeading>

        <ol className="mt-16 grid gap-x-0 gap-y-14 sm:grid-cols-2 lg:grid-cols-4">
          {STAGES.map(({ name, title, body, spec, Visual }, index) => (
            <li
              key={name}
              className={cn(
                "relative flex flex-col border-dashed border-(--lc-line-strong)",
                columnClass(index, STAGES.length),
              )}
            >
              <StageConnector index={index} />
              <Visual />
              <p className="mt-7 flex items-center gap-2.5 text-[15px] font-semibold text-(--lc-accent)">
                <span className="inline-flex size-6 items-center justify-center rounded-full bg-(--lc-accent-soft) text-[12px] tabular-nums">
                  {index + 1}
                </span>
                {name}
              </p>
              <h3 className="mt-3 text-[18px] leading-snug font-semibold tracking-[-0.015em] text-(--lc-ink)">
                {title}
              </h3>
              <p className="mt-2 flex-1 text-[15px] leading-[1.6] text-(--lc-body)">{body}</p>
              <p className="mt-5 font-mono text-[12px] text-(--lc-muted)">{spec}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
