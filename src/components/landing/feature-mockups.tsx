import type { ReactNode } from "react";
import { mockRepositoryGraph } from "@/fixtures/mock-repository-graph";
import type { FileNode, RepositoryGraph } from "@/graph/model/types";
import { DEFAULT_LIMITS } from "@/lib/config/limits";
import { getLanguage, getLanguageColor } from "@/lib/languages/registry";
import { encodeShareState } from "@/lib/share/url-state";
import { cn } from "@/lib/utils/cn";
import { formatDate, formatInteger } from "@/lib/utils/format";
import { explorePath } from "@/lib/validation/repository-url";
import { cityGeometry } from "./city-geometry";
import { IsoArt } from "./iso-art";

/**
 * Product-UI miniatures for the feature grid. Every value is read from the
 * demo repository's graph or from the code that defines the behaviour, so the
 * miniatures stay true as the product changes. All are decorative (the card
 * text carries the meaning).
 */

const graph: RepositoryGraph = mockRepositoryGraph;
const filesById = new Map(graph.files.map((file) => [file.id, file]));
const SELECTED_PATH = "src/auth/auth.ts";
const selected = graph.files.find((file) => file.path === SELECTED_PATH);

function Surface({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "rounded-xl bg-white shadow-[0_1px_2px_rgb(15_28_63/0.06),0_10px_28px_-14px_rgb(15_28_63/0.28)] ring-1 ring-[rgb(15_28_63/0.07)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

function Dot({ color, className }: { color: string; className?: string }) {
  return (
    <span
      className={cn("inline-block size-2 shrink-0 rounded-full", className)}
      style={{ backgroundColor: color }}
    />
  );
}

/**
 * Shortest path suffix that tells each file apart from the others shown, so
 * src/api/handlers/auth.ts reads "handlers/auth.ts" next to src/auth/auth.ts.
 */
function distinctLabels(files: readonly FileNode[]): Map<string, string> {
  const labels = new Map<string, string>();
  for (const file of files) {
    const parts = file.path.split("/");
    let depth = 1;
    const suffix = (path: string, count: number) => path.split("/").slice(-count).join("/");
    while (
      depth < parts.length &&
      files.some((other) => other.id !== file.id && suffix(other.path, depth) === suffix(file.path, depth))
    ) {
      depth += 1;
    }
    labels.set(file.id, suffix(file.path, depth));
  }
  return labels;
}

function FilePill({
  file,
  label,
  emphasis = false,
}: {
  file: FileNode;
  label?: string;
  emphasis?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-md bg-white px-2 font-mono text-[11px] whitespace-nowrap ring-1",
        emphasis
          ? "font-semibold text-(--lc-ink) shadow-[0_0_0_3px_rgb(91_71_235/0.14)] ring-(--lc-accent)"
          : "text-(--lc-body) ring-(--lc-line-strong)",
      )}
    >
      <Dot color={getLanguageColor(file.language)} className="size-1.5" />
      {label ?? file.name}
    </span>
  );
}

// ─── Architecture districts ─────────────────────────────────────────────────

export function ArchitectureMockup() {
  const languages = graph.languages
    .filter((language) => getLanguage(language.id).category === "source")
    .sort((a, b) => b.files - a.files)
    .slice(0, 5);
  return (
    <div className="relative flex h-full items-center">
      <IsoArt
        geometry={cityGeometry(graph)}
        className="h-[112%] w-auto max-w-none shrink-0 translate-x-[-2%] translate-y-[4%]"
      />
      <Surface className="absolute top-5 right-5 w-[148px] p-3">
        <p className="text-[11px] font-semibold text-(--lc-ink)">Languages</p>
        <ul className="mt-2 space-y-1.5">
          {languages.map((language) => (
            <li key={language.id} className="flex items-center gap-2 text-[11px] text-(--lc-body)">
              <Dot color={language.color} />
              <span className="flex-1">{language.name}</span>
              <span className="text-(--lc-muted) tabular-nums">{language.files}</span>
            </li>
          ))}
        </ul>
      </Surface>
    </div>
  );
}

// ─── Dependency arcs ────────────────────────────────────────────────────────

export function DependencyMockup() {
  if (!selected) return null;
  const imports = graph.dependencies
    .filter((edge) => edge.source === selected.id)
    .map((edge) => filesById.get(edge.target))
    .filter((file): file is FileNode => Boolean(file))
    .slice(0, 4);
  const importers = graph.dependencies
    .filter((edge) => edge.target === selected.id)
    .map((edge) => filesById.get(edge.source))
    .filter((file): file is FileNode => Boolean(file))
    .slice(0, 4);
  const labels = distinctLabels([selected, ...imports, ...importers]);
  // Row centers in a 200-unit tall box. Pills are opaque and sit above the
  // arcs, so each arc can run between pill centers.
  const rowY = (index: number, count: number) => 100 + (index - (count - 1) / 2) * 38;

  return (
    // Phones drop the importer column (it becomes a caption under the
    // selected file) so the fan of imports still fits a narrow card.
    <div className="relative grid h-full grid-cols-[auto_1fr] items-center gap-x-3 px-4 sm:grid-cols-[1fr_1.1fr_1fr] sm:gap-x-0 sm:px-6">
      <svg
        viewBox="0 0 100 200"
        preserveAspectRatio="none"
        className="absolute inset-y-0 left-[16%] hidden h-full w-[34%] sm:block"
      >
        {importers.map((file, index) => (
          <path
            key={file.id}
            d={`M0 ${rowY(index, importers.length)} C 45 ${rowY(index, importers.length)}, 55 100, 100 100`}
            fill="none"
            stroke="#8a95b0"
            strokeWidth={1.25}
            strokeDasharray="3 4"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      <svg
        viewBox="0 0 100 200"
        preserveAspectRatio="none"
        className="absolute inset-y-0 left-[26%] h-full w-[56%] sm:left-1/2 sm:w-[34%]"
      >
        {imports.map((file, index) => (
          <path
            key={file.id}
            d={`M0 100 C 45 100, 55 ${rowY(index, imports.length)}, 100 ${rowY(index, imports.length)}`}
            fill="none"
            stroke="#5b47eb"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      <div className="relative hidden flex-col items-start gap-2.5 sm:flex">
        <p className="text-[10.5px] font-semibold text-(--lc-muted)">
          Imported by {importers.length}
        </p>
        {importers.map((file) => (
          <FilePill key={file.id} file={file} label={labels.get(file.id)} />
        ))}
      </div>
      <div className="relative flex flex-col items-start gap-1.5 sm:items-center">
        <FilePill file={selected} label={labels.get(selected.id)} emphasis />
        <p className="pl-1 text-[10.5px] font-semibold text-(--lc-muted) sm:hidden">
          Imported by {importers.length}
        </p>
      </div>
      <div className="relative flex flex-col items-end gap-2.5">
        <p className="text-[10.5px] font-semibold text-(--lc-accent-strong)">
          Imports {imports.length}
        </p>
        {imports.map((file) => (
          <FilePill key={file.id} file={file} label={labels.get(file.id)} />
        ))}
      </div>
    </div>
  );
}

// ─── Activity & history ─────────────────────────────────────────────────────

export function ActivityMockup() {
  const times = graph.commits.map((commit) => Date.parse(commit.date));
  const start = Math.min(...times);
  const end = Math.max(...times);
  const position = (time: number) => (end > start ? ((time - start) / (end - start)) * 100 : 100);
  const latest = graph.commits[0];
  return (
    <div className="flex h-full flex-col justify-center gap-4 px-5">
      <Surface className="px-3 py-2.5">
        <p className="truncate text-[12px] font-semibold text-(--lc-ink)">{latest?.message}</p>
        <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-(--lc-muted)">
          <span>{latest ? formatDate(latest.date) : ""}</span>·
          <span>{latest?.authorName}</span>·
          <span>{formatInteger(latest?.fileIds?.length ?? 0)} files lit</span>
        </p>
      </Surface>
      <div className="relative h-10">
        <div className="absolute inset-x-0 top-1/2 h-px bg-(--lc-line-strong)" />
        {times.map((time, index) => (
          <span
            key={index}
            className="absolute top-1/2 h-3 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#f5a524]"
            style={{ left: `${position(time)}%` }}
          />
        ))}
        <span className="absolute top-0 right-0 flex h-full translate-x-1/2 flex-col items-center">
          <span className="h-full w-[2px] rounded-full bg-(--lc-ink)" />
        </span>
        <span className="absolute top-1/2 right-0 size-3.5 translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_1px_3px_rgb(15_28_63/0.35)] ring-2 ring-(--lc-ink)" />
      </div>
      <p className="-mt-2 flex justify-between font-mono text-[10.5px] text-(--lc-muted)">
        <span>{graph.commits.length} commits</span>
        <span>now</span>
      </p>
    </div>
  );
}

// ─── Contributors ───────────────────────────────────────────────────────────

const CONTRIBUTOR_COLORS = ["#5b47eb", "#0e9fc4", "#d6368f", "#e08a1e"] as const;

export function ContributorsMockup() {
  const contributors = [...graph.contributors].sort((a, b) => b.contributions - a.contributions);
  const max = contributors[0]?.contributions ?? 1;
  return (
    <ul className="flex h-full flex-col justify-center gap-3 px-5">
      {contributors.slice(0, 4).map((contributor, index) => {
        const color = CONTRIBUTOR_COLORS[index % CONTRIBUTOR_COLORS.length] ?? "#5b47eb";
        return (
          <li key={contributor.id} className="flex items-center gap-2.5">
            <span
              className="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
              style={{ backgroundColor: color }}
            >
              {contributor.name.slice(0, 1)}
            </span>
            <span className="w-[74px] truncate font-mono text-[11px] text-(--lc-ink)">
              {contributor.login}
            </span>
            <span className="h-1.5 flex-1 rounded-full bg-(--lc-mist)">
              <span
                className="block h-full rounded-full"
                style={{ width: `${(contributor.contributions / max) * 100}%`, backgroundColor: color }}
              />
            </span>
            <span className="w-8 text-right text-[11px] text-(--lc-muted) tabular-nums">
              {contributor.contributions}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

// ─── Complexity ─────────────────────────────────────────────────────────────

export function ComplexityMockup() {
  const hotspots = graph.files
    .filter((file) => file.category === "source" && !file.isGenerated)
    .sort((a, b) => b.lines - a.lines)
    .slice(0, 4);
  const max = hotspots[0]?.lines ?? 1;
  return (
    <ul className="flex h-full flex-col justify-center gap-3 px-5">
      {hotspots.map((file, index) => (
        <li key={file.id} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1">
          <span className="truncate font-mono text-[11px] text-(--lc-ink)">{file.name}</span>
          <span className="text-[10.5px] text-(--lc-muted) tabular-nums">
            {formatInteger(file.lines)} lines · {file.symbolIds.length} symbols
          </span>
          <span className="col-span-2 h-1.5 rounded-full bg-(--lc-mist)">
            <span
              className="block h-full rounded-full"
              style={{
                width: `${(file.lines / max) * 100}%`,
                background: index === 0 ? "linear-gradient(90deg,#f5a524,#d6368f)" : "#f3b86a",
              }}
            />
          </span>
        </li>
      ))}
    </ul>
  );
}

// ─── Search & source ────────────────────────────────────────────────────────

const QUERY = "auth";

export function SearchMockup() {
  const seen = new Set<string>();
  const results = graph.symbols
    .filter((symbol) => symbol.name.toLowerCase().includes(QUERY) && symbol.kind !== "interface")
    .filter((symbol) => !seen.has(symbol.name) && Boolean(seen.add(symbol.name)))
    .slice(0, 3);
  return (
    <div className="flex h-full flex-col justify-center px-5">
      <Surface className="overflow-hidden">
        <div className="flex items-center gap-2 border-b border-(--lc-line) px-3 py-2">
          <kbd className="rounded bg-(--lc-mist) px-1.5 font-mono text-[10.5px] text-(--lc-muted) ring-1 ring-(--lc-line-strong)">
            /
          </kbd>
          <span className="font-mono text-[12px] text-(--lc-ink)">
            {QUERY}
            <span className="ml-px inline-block h-3.5 w-px translate-y-0.5 bg-(--lc-accent)" />
          </span>
        </div>
        <ul className="p-1">
          {results.map((symbol, index) => {
            const file = filesById.get(symbol.fileId);
            return (
              <li
                key={symbol.id}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-1.5",
                  index === 0 && "bg-(--lc-accent-soft)",
                )}
              >
                <span className="w-[44px] shrink-0 text-[10px] font-semibold text-(--lc-accent-strong)">
                  {symbol.kind}
                </span>
                <span className="shrink-0 font-mono text-[11px] text-(--lc-ink)">{symbol.name}</span>
                <span className="ml-auto min-w-0 truncate pl-2 font-mono text-[10px] text-(--lc-muted)">
                  {file?.name}:{symbol.startLine}
                </span>
              </li>
            );
          })}
        </ul>
      </Surface>
    </div>
  );
}

// ─── Shareable views ────────────────────────────────────────────────────────

export function ShareMockup() {
  const params = encodeShareState({
    ref: graph.repository.ref,
    mode: "dependencies",
    selection: selected ? { kind: "file", id: selected.id } : undefined,
    camera: { position: [42, 36, 58], target: [0, 0, 0] },
  });
  const path = explorePath(graph.repository.owner, graph.repository.name);
  const entries = [...params.entries()];
  const captured = ["Revision", "Mode", "Selection", "Camera"] as const;
  return (
    <div className="flex h-full flex-col justify-center gap-4 px-5 sm:px-8">
      <Surface className="flex items-center gap-2 p-1.5 pl-3">
        <p className="min-w-0 flex-1 font-mono text-[11.5px] leading-[1.6] [overflow-wrap:anywhere] text-(--lc-muted)">
          <span className="text-(--lc-ink)">{path}</span>
          {entries.map(([key, value], index) => (
            <span key={key}>
              {/* Prefer wrapping between parameters, never inside one. */}
              <wbr />
              {index === 0 ? "?" : "&"}
              <span className="font-semibold text-(--lc-accent-strong)">{key}</span>=
              <span className="text-(--lc-ink)">{value}</span>
            </span>
          ))}
        </p>
        <span className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md bg-(--lc-ink) px-2.5 text-[11px] font-semibold text-white">
          <svg viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth={1.6}>
            <path d="M2.5 6.5 5 9l4.5-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Copied
        </span>
      </Surface>
      <ul className="flex flex-wrap gap-x-5 gap-y-2 text-[11.5px] text-(--lc-body)">
        {captured.map((item) => (
          <li key={item} className="flex items-center gap-1.5">
            <span className="inline-flex size-4 items-center justify-center rounded-full bg-[#e3f6ec] text-[#16794a]">
              <svg viewBox="0 0 12 12" className="size-2.5" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M2.5 6.5 5 9l4.5-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Large repositories ─────────────────────────────────────────────────────

export function LargeRepositoryMockup() {
  const tiers = [
    { name: "Full", range: `up to ${formatInteger(DEFAULT_LIMITS.tierFullMax)} files`, note: "everything parsed", tone: "bg-[#e9e6ff] text-(--lc-accent-strong)" },
    { name: "Progressive", range: `to ${formatInteger(DEFAULT_LIMITS.tierProgressiveMax)}`, note: "source parsed first", tone: "bg-[#dff3fb] text-[#0b6b86]" },
    { name: "Directory-first", range: `above ${formatInteger(DEFAULT_LIMITS.tierProgressiveMax)}`, note: `≤ ${formatInteger(DEFAULT_LIMITS.maxFiles)} buildings`, tone: "bg-[#fdeedd] text-[#9a5410]" },
  ] as const;
  return (
    <div className="flex h-full flex-col justify-center gap-3 px-5 sm:px-8">
      {/* Rows on phones, a left-to-right scale from sm up. */}
      <ol className="grid gap-1.5 sm:grid-cols-[1fr_1.25fr_1.5fr]">
        {tiers.map((tier) => (
          <li key={tier.name}>
            <div
              className={cn(
                "flex items-baseline justify-between gap-3 rounded-lg px-3 py-2 sm:block sm:py-2.5",
                tier.tone,
              )}
            >
              <p className="text-[12px] font-semibold">{tier.name}</p>
              <p className="font-mono text-[10.5px] opacity-90 sm:mt-0.5">{tier.range}</p>
            </div>
            <p className="mt-2 hidden px-1 text-[11px] text-(--lc-muted) sm:block">{tier.note}</p>
          </li>
        ))}
      </ol>
      <Surface className="mt-1 flex items-center gap-2 px-3 py-2 text-[11px] text-(--lc-body)">
        <span className="size-1.5 shrink-0 rounded-full bg-[#e08a1e]" />
        The coverage report says what was left out, and why.
      </Surface>
    </div>
  );
}
