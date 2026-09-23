import { MousePointerClick, Rotate3d, ZoomIn } from "lucide-react";
import { mockRepositoryGraph } from "@/fixtures/mock-repository-graph";
import { formatInteger } from "@/lib/utils/format";
import { SECTION_IDS } from "../constants";
import { SectionHeading } from "../section-heading";
import { DemoPoster } from "./demo-poster";
import { InteractiveDemo } from "./interactive-demo";

const TIPS = [
  { icon: Rotate3d, action: "Drag", detail: "to orbit the camera" },
  { icon: MousePointerClick, action: "Click", detail: "a building to inspect its file" },
  { icon: ZoomIn, action: "Scroll", detail: "to zoom, once you've clicked into the scene" },
] as const;

/** Section 01: the live 3D demo running on the bundled demo repository. */
export function DemoSection() {
  const graph = mockRepositoryGraph;
  const languageCount = graph.languages.filter((language) => language.id !== "unknown").length;
  const stats = [
    { label: "files", value: graph.files.length },
    { label: "symbols", value: graph.symbols.length },
    { label: "dependencies", value: graph.dependencies.length },
    { label: "commits", value: graph.commits.length },
    { label: "languages", value: languageCount },
  ];

  return (
    <section
      id={SECTION_IDS.demo}
      aria-labelledby="demo-title"
      className="mx-auto max-w-6xl scroll-mt-16 px-4 py-20 sm:px-6 lg:py-28"
    >
      <SectionHeading
        id="demo-title"
        index="01"
        eyebrow="Live demo"
        title="The real engine, running on a demo repository."
      >
        <p>
          Every building below is a file in{" "}
          <span className="text-ink font-mono">{graph.repository.fullName}</span>, a small polyglot
          monorepo bundled with CodeVerse. It is drawn by the same layout engine and WebGL renderer
          as the explorer, entirely in your browser.
        </p>
      </SectionHeading>

      <figure className="mt-10">
        <InteractiveDemo
          label={`Demo repository · ${graph.repository.fullName}`}
          poster={<DemoPoster graph={graph} className="h-full w-full" />}
          className="h-[420px] sm:h-[520px] lg:h-[600px]"
        />
        <figcaption className="mt-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <ul className="text-ink-muted flex flex-col gap-2 text-sm sm:flex-row sm:flex-wrap sm:gap-x-6">
            {TIPS.map(({ icon: Icon, action, detail }) => (
              <li key={action} className="flex items-center gap-2">
                <Icon aria-hidden="true" className="text-signal size-4 shrink-0" />
                <span>
                  <span className="text-ink font-medium">{action}</span> {detail}
                </span>
              </li>
            ))}
          </ul>
          <dl className="text-ink-muted flex flex-wrap gap-x-5 gap-y-1 font-mono text-xs">
            {stats.map((stat) => (
              // Term first in the DOM (label, value), value first on screen.
              <div key={stat.label} className="flex flex-row-reverse items-baseline gap-1.5">
                <dt>{stat.label}</dt>
                <dd className="text-ink">{formatInteger(stat.value)}</dd>
              </div>
            ))}
          </dl>
        </figcaption>
      </figure>
    </section>
  );
}
