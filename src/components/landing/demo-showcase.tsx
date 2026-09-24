import { Hand, MousePointerClick, Pointer, Rotate3d, ZoomIn } from "lucide-react";
import { DemoPoster } from "@/components/landing/demo/demo-poster";
import { InteractiveDemo } from "@/components/landing/demo/interactive-demo";
import { mockRepositoryGraph } from "@/fixtures/mock-repository-graph";
import { cn } from "@/lib/utils/cn";
import { formatInteger } from "@/lib/utils/format";
import styles from "./landing.module.css";
import { SectionHeading } from "./section-heading";
import { ANCHORS, CONTAINER } from "./tokens";

/**
 * Controls as the demo implements them: the wheel zooms only after a click
 * into the scene, and touch devices tap "Tap to interact" before the world
 * takes gestures. The list matching the primary pointer is shown (CSS only,
 * so nothing shifts after hydration).
 */
const GESTURES = {
  fine: [
    { Icon: Rotate3d, gesture: "Drag", result: "to orbit" },
    { Icon: MousePointerClick, gesture: "Click", result: "a building to inspect it" },
    { Icon: ZoomIn, gesture: "Scroll", result: "to zoom, after clicking in" },
  ],
  coarse: [
    { Icon: Hand, gesture: "Tap", result: "the world to take control" },
    { Icon: Rotate3d, gesture: "Drag", result: "to orbit, pinch to zoom" },
    { Icon: Pointer, gesture: "Tap", result: "a building to inspect it" },
  ],
} as const;

function GestureList({ pointer }: { pointer: keyof typeof GESTURES }) {
  return (
    <ul
      aria-label="Controls"
      className={cn(
        "shrink-0 flex-col gap-3 text-[15px] text-(--lc-body) lg:pb-1",
        pointer === "fine" ? "flex pointer-coarse:hidden" : "hidden pointer-coarse:flex",
      )}
    >
      {GESTURES[pointer].map(({ Icon, gesture, result }) => (
        <li key={`${gesture} ${result}`} className="flex items-center gap-3">
          <Icon
            aria-hidden="true"
            strokeWidth={1.75}
            className="size-[18px] shrink-0 text-(--lc-accent)"
          />
          <span>
            <span className="font-semibold text-(--lc-ink)">{gesture}</span> {result}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Section 1: the live 3D world in a device frame that overlaps the edge of the
 * mist band, the classic "dark product on a light page" shot.
 */
export function DemoShowcase() {
  const graph = mockRepositoryGraph;
  const fullName = graph.repository.fullName;
  const stats = [
    { label: "files", value: graph.files.length },
    { label: "symbols", value: graph.symbols.length },
    { label: "dependencies", value: graph.dependencies.length },
    { label: "commits", value: graph.commits.length },
    {
      label: "languages",
      value: graph.languages.filter((language) => language.id !== "unknown").length,
    },
  ];

  return (
    <section
      id={ANCHORS.demo}
      aria-labelledby="demo-title"
      className="relative isolate scroll-mt-4 pt-24 pb-10 sm:pt-28 lg:pt-32"
    >
      <div
        aria-hidden="true"
        className={cn(
          "absolute inset-x-0 top-0 -z-10 bottom-[300px] bg-(--lc-mist) sm:bottom-[360px] lg:bottom-[400px]",
          styles.skewBottom,
        )}
      />
      <div className={CONTAINER}>
        <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
          <SectionHeading
            id="demo-title"
            eyebrow="Interactive example"
            title="The real engine, running on a demo repository."
          >
            <p>
              Every building is a file in{" "}
              <span className="font-mono text-[0.92em] text-(--lc-ink)">{fullName}</span>, a small
              polyglot monorepo bundled with CodeVerse. Same layout engine, same WebGL renderer as
              the explorer, entirely in your browser.
            </p>
          </SectionHeading>
          <GestureList pointer="fine" />
          <GestureList pointer="coarse" />
        </div>

        <figure className="mt-12 lg:mt-14">
          <div className="rounded-[26px] bg-linear-to-b from-white to-[#eef1f7] p-2 shadow-[0_2px_4px_rgb(15_28_63/0.04),0_24px_48px_-16px_rgb(15_28_63/0.2),0_80px_120px_-40px_rgb(40_30_120/0.35)] ring-1 ring-[rgb(15_28_63/0.08)] sm:p-2.5">
            <div className="flex h-9 items-center gap-3 px-2.5 pb-1.5 sm:h-10">
              <span aria-hidden="true" className="flex gap-1.5">
                <span className="size-2.5 rounded-full bg-[#d5dbe7]" />
                <span className="size-2.5 rounded-full bg-[#d5dbe7]" />
                <span className="size-2.5 rounded-full bg-[#d5dbe7]" />
              </span>
              <p className="mx-auto flex min-w-0 items-center gap-2 text-[12.5px] font-medium text-(--lc-muted)">
                <span className="hidden truncate sm:inline">CodeVerse explorer</span>
                <span className="shrink-0 rounded-full bg-(--lc-accent-soft) px-2 py-0.5 font-sans text-[11px] font-semibold text-(--lc-accent-strong)">
                  Demo repository
                </span>
              </p>
              <span aria-hidden="true" className="w-[42px]" />
            </div>
            <InteractiveDemo
              label={fullName}
              poster={<DemoPoster graph={graph} className="h-full w-full" />}
              className="h-[380px] sm:h-[540px] lg:h-[640px]"
            />
          </div>
          <figcaption className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[14px] text-(--lc-muted)">
              Rendered live from a graph bundled with the page. Nothing is fetched from GitHub.
            </p>
            <dl className="flex flex-wrap gap-x-5 gap-y-1.5 text-[14px] text-(--lc-muted)">
              {stats.map((stat) => (
                <div key={stat.label} className="flex flex-row-reverse items-baseline gap-1.5">
                  <dt>{stat.label}</dt>
                  <dd className="font-semibold text-(--lc-ink) tabular-nums">
                    {formatInteger(stat.value)}
                  </dd>
                </div>
              ))}
            </dl>
          </figcaption>
        </figure>
      </div>
    </section>
  );
}
