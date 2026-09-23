import type { ComponentType } from "react";
import { SECTION_IDS } from "./constants";
import { FetchDiagram, GraphDiagram, ParseDiagram, RenderDiagram } from "./pipeline-diagrams";
import { SectionHeading } from "./section-heading";

interface PipelineStep {
  name: string;
  title: string;
  body: string;
  /** Monospace implementation note. */
  spec: string;
  Diagram: ComponentType;
}

const STEPS: readonly PipelineStep[] = [
  {
    name: "Fetch",
    title: "Read the repository through the GitHub API",
    body: "The file tree, source files and recent history stream in over HTTPS. Nothing is cloned, installed or built, and no repository code is ever executed.",
    spec: "REST + GraphQL · byte and file limits",
    Diagram: FetchDiagram,
  },
  {
    name: "Parse",
    title: "Build real syntax trees",
    body: "tree-sitter grammars compiled to WebAssembly parse TypeScript, JavaScript, Python, Java, Go and Rust, extracting declarations, exports and imports.",
    spec: "web-tree-sitter · 6 languages",
    Diagram: ParseDiagram,
  },
  {
    name: "Graph",
    title: "Normalize into a RepositoryGraph",
    body: "Directories, files, symbols, resolved imports, commits and contributors become one provider-agnostic model, cached per repository and commit.",
    spec: "repository@commit · no source stored",
    Diagram: GraphDiagram,
  },
  {
    name: "Render",
    title: "Lay out and draw the universe",
    body: "A deterministic layout turns directories into districts and files into buildings. Instanced WebGL draws thousands of them; detail appears only up close.",
    spec: "three.js · instancing · level of detail",
    Diagram: RenderDiagram,
  },
];

/** Section 02: the four-stage pipeline. */
export function HowItWorks() {
  return (
    <section
      id={SECTION_IDS.howItWorks}
      aria-labelledby="how-it-works-title"
      className="border-line bg-abyss/60 scroll-mt-16 border-y"
    >
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-28">
        <SectionHeading
          id="how-it-works-title"
          index="02"
          eyebrow="How it works"
          title="From a URL to a universe in four stages."
        >
          <p>
            Analysis runs on the server as a single streamed request. Your browser receives a
            normalized graph; source is fetched only for the files you open.
          </p>
        </SectionHeading>

        <ol className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map(({ name, title, body, spec, Diagram }, index) => (
            <li
              key={name}
              className="group border-line bg-panel/60 relative flex flex-col rounded-2xl border p-5"
            >
              <div className="flex items-center justify-between font-mono text-[11px] tracking-[0.2em] uppercase">
                <span className="text-signal">
                  {String(index + 1).padStart(2, "0")} · {name}
                </span>
                {index < STEPS.length - 1 ? (
                  <span aria-hidden="true" className="text-ink-muted hidden lg:inline">
                    →
                  </span>
                ) : null}
              </div>
              <div className="border-line/80 bg-void/60 mt-4 rounded-xl border p-2">
                <Diagram />
              </div>
              <h3 className="text-ink mt-5 text-base font-semibold tracking-[-0.01em]">{title}</h3>
              <p className="text-ink-muted mt-2 flex-1 text-sm leading-relaxed">{body}</p>
              <p className="border-line text-ink-muted mt-5 border-t pt-3 font-mono text-[11px]">
                {spec}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
