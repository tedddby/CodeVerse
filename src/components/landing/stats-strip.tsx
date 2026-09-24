import { DEFAULT_LIMITS } from "@/lib/config/limits";
import { LANGUAGES, PARSER_LANGUAGE_IDS } from "@/lib/languages/registry";
import { cn } from "@/lib/utils/cn";
import { formatInteger } from "@/lib/utils/format";
import { CONTAINER } from "./tokens";

/** "tsx" is a separate grammar reported as TypeScript. */
const PARSED_LANGUAGE_COUNT = PARSER_LANGUAGE_IDS.filter((id) => id !== "tsx").length;

/** Every number is read from the code that enforces it. */
const STATS = [
  {
    value: formatInteger(PARSED_LANGUAGE_COUNT),
    label: "languages parsed into syntax trees",
  },
  {
    value: formatInteger(DEFAULT_LIMITS.maxFiles),
    label: "files drawn per world by default",
  },
  {
    value: formatInteger(LANGUAGES.length),
    label: "languages recognized and colored",
  },
  {
    value: "0",
    label: "lines of repository code executed",
  },
] as const;

/**
 * Four true numbers under the hero. Each sits on a hairline with a short
 * accent tick level with the figure, the way a spec sheet marks its values.
 */
export function StatsStrip() {
  return (
    <section aria-labelledby="lc-stats-title" className="relative bg-white pt-16 pb-6 sm:pt-20">
      <h2 id="lc-stats-title" className="sr-only">
        CodeVerse in numbers
      </h2>
      <dl className={cn(CONTAINER, "grid grid-cols-2 gap-x-4 gap-y-10 lg:grid-cols-4 lg:gap-x-8")}>
        {STATS.map((stat) => (
          <div
            key={stat.label}
            className="relative flex flex-col gap-2.5 border-l border-(--lc-line) pl-4 before:absolute before:top-0 before:-left-px before:h-[clamp(2rem,1.5rem+1.6vw,2.75rem)] before:w-px before:bg-(--lc-accent) sm:pl-6"
          >
            <dt className="order-2 max-w-[16rem] text-[15px] leading-snug text-balance text-(--lc-body)">
              {stat.label}
            </dt>
            <dd className="order-1 text-[clamp(2rem,1.5rem+1.6vw,2.75rem)] leading-none font-semibold tracking-[-0.035em] text-(--lc-ink) tabular-nums">
              {stat.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
