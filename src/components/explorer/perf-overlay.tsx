"use client";

import { ANALYSIS_STAGES, STAGE_LABELS } from "@/analysis/protocol";
import { useRenderStats } from "@/engine/rendering/render-stats";
import { cn } from "@/lib/utils/cn";
import { formatCompact, formatInteger } from "@/lib/utils/format";
import { useExplorerStore } from "@/state/explorer-store";

function formatMs(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms)) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`;
}

function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "ok" | "warn" | "danger";
}) {
  return (
    <div className="flex items-baseline justify-between gap-6">
      <dt className="text-ink-subtle">{label}</dt>
      <dd
        className={cn(
          "tabular-nums",
          tone === "ok"
            ? "text-ok"
            : tone === "warn"
              ? "text-warn"
              : tone === "danger"
                ? "text-danger"
                : "text-ink",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

/** Developer/performance overlay toggled with the backquote key. */
export function PerfOverlay({ className }: { className?: string }) {
  const stats = useRenderStats();
  const layout = useExplorerStore((state) => state.layout);
  const analysis = useExplorerStore((state) => state.graph?.analysis ?? null);
  const fpsTone = stats.fps >= 50 ? "ok" : stats.fps >= 30 ? "warn" : "danger";

  return (
    <aside
      aria-label="Performance statistics"
      className={cn(
        "glass animate-fade-in pointer-events-auto w-60 rounded-xl p-3 font-mono text-[11px] leading-5 shadow-2xl",
        className,
      )}
    >
      <p className="text-ink-subtle mb-1.5 flex items-center justify-between text-[10px] tracking-[0.2em] uppercase">
        Performance <kbd className="kbd">`</kbd>
      </p>
      <dl>
        <Row
          label="FPS"
          value={stats.fps > 0 ? formatInteger(stats.fps) : "—"}
          tone={stats.fps > 0 ? fpsTone : undefined}
        />
        <Row label="Draw calls" value={formatInteger(stats.drawCalls)} />
        <Row label="Triangles" value={formatCompact(stats.triangles)} />
        <Row label="Instances" value={formatInteger(stats.instances)} />
        <Row label="Labels" value={formatInteger(stats.labels)} />
        <Row label="Edges" value={formatInteger(stats.edges)} />
        <Row label="Layout" value={layout ? formatMs(layout.durationMs) : "—"} />
      </dl>
      {analysis ? (
        <dl className="border-line/80 mt-2 border-t pt-2">
          <Row
            label={analysis.cached ? "Analysis (cached)" : "Analysis"}
            value={formatMs(analysis.durationMs)}
          />
          {ANALYSIS_STAGES.filter((stage) => analysis.timings[stage] !== undefined).map((stage) => (
            <Row
              key={stage}
              label={STAGE_LABELS[stage]}
              value={formatMs(analysis.timings[stage])}
            />
          ))}
        </dl>
      ) : null}
    </aside>
  );
}
