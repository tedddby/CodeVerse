import type { ReactNode } from "react";
import { mockRepositoryGraph } from "@/fixtures/mock-repository-graph";
import { DEFAULT_LIMITS } from "@/lib/config/limits";
import { cn } from "@/lib/utils/cn";
import { formatBytes, formatInteger } from "@/lib/utils/format";
import { cityGeometry } from "./city-geometry";
import { IsoArt } from "./iso-art";

/**
 * Small, precise product details for the four pipeline stages. Each is a
 * miniature of what that stage actually produces, using the demo repository.
 */

function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "relative h-[172px] overflow-hidden rounded-xl bg-white p-3.5 font-mono text-[11.5px] leading-[1.55] text-(--lc-body) shadow-[0_1px_2px_rgb(15_28_63/0.05),0_8px_24px_-12px_rgb(15_28_63/0.16)] ring-1 ring-(--lc-line)",
        className,
      )}
    >
      {children}
    </div>
  );
}

const REQUESTS = [
  { path: "/repos/{owner}/{repo}", note: "metadata" },
  { path: "…/git/trees/{sha}", note: "recursive" },
  { path: "…/commits?sha={sha}", note: "history" },
] as const;

export function FetchVisual() {
  return (
    <Panel>
      <ul className="space-y-2">
        {REQUESTS.map((request) => (
          <li key={request.path} className="flex items-center gap-2">
            <span className="rounded bg-(--lc-accent-soft) px-1.5 text-[10.5px] font-semibold text-(--lc-accent-strong)">
              GET
            </span>
            <span className="min-w-0 flex-1 truncate text-(--lc-ink)">{request.path}</span>
            <span className="text-[#1a7f4e]">200</span>
          </li>
        ))}
      </ul>
      <div className="absolute inset-x-3.5 bottom-3 border-t border-dashed border-(--lc-line-strong) pt-2.5">
        <div className="flex justify-between">
          <span>raw files</span>
          <span className="text-(--lc-ink)">≤ {formatBytes(DEFAULT_LIMITS.maxTotalBytes)}</span>
        </div>
        <div className="flex justify-between">
          <span>executed</span>
          <span className="text-(--lc-ink)">nothing</span>
        </div>
      </div>
    </Panel>
  );
}

/** tree-sitter-typescript node types for the demo's src/auth/auth.ts. */
const SYNTAX_TREE = [
  { depth: 0, node: "program", detail: "auth.ts" },
  { depth: 1, node: "import_statement", detail: "./jwt" },
  { depth: 1, node: "class_declaration", detail: "AuthService" },
  { depth: 2, node: "method_definition", detail: "refresh" },
  { depth: 2, node: "method_definition", detail: "revoke" },
  { depth: 1, node: "export_statement", detail: "hashPassword" },
] as const;

export function ParseVisual() {
  return (
    <Panel>
      <ul className="space-y-[3px] text-[11px]">
        {SYNTAX_TREE.map((row, index) => (
          <li key={index} className="flex items-center gap-1.5 whitespace-nowrap">
            <span
              className="shrink-0 border-l border-(--lc-line-strong)"
              style={{ width: row.depth * 10, height: 14, opacity: row.depth ? 1 : 0 }}
            />
            <span className={row.depth === 0 ? "font-semibold text-(--lc-ink)" : "text-[#7b3fb8]"}>
              {row.node}
            </span>
            {row.detail ? <span className="truncate text-(--lc-ink)">{row.detail}</span> : null}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export function GraphVisual() {
  const graph = mockRepositoryGraph;
  const rows = [
    ["directories", graph.directories.length],
    ["files", graph.files.length],
    ["symbols", graph.symbols.length],
    ["dependencies", graph.dependencies.length],
    ["commits", graph.commits.length],
  ] as const;
  return (
    <Panel>
      <p className="flex justify-between text-(--lc-ink)">
        <span className="font-semibold">RepositoryGraph</span>
        <span className="text-(--lc-muted)">{graph.repository.name}</span>
      </p>
      <dl className="mt-2 space-y-[3px]">
        {rows.map(([key, value]) => (
          <div key={key} className="flex items-baseline gap-2">
            <dt>{key}</dt>
            <span className="flex-1 border-b border-dotted border-(--lc-line-strong)" />
            <dd className="text-(--lc-ink) tabular-nums">{formatInteger(value)}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

export function RenderVisual() {
  return (
    <Panel className="flex items-center justify-center bg-linear-to-b from-white to-(--lc-mist) p-2">
      <IsoArt geometry={cityGeometry(mockRepositoryGraph)} className="h-full w-full" />
    </Panel>
  );
}
