"use client";

import { Html } from "@react-three/drei";
import { useMemo } from "react";
import { LanguageDot } from "@/components/ui/primitives";
import { useExplorerStore } from "@/state/explorer-store";
import { tooltipContent } from "./tooltip-content";
import { useWorld } from "./world-context";

/**
 * A small label that follows the hovered building, district or symbol band:
 * name, language dot and size (with "~" when line counts are estimated).
 * Pointer-transparent and rendered as plain text (repository data is untrusted).
 */

export function HoverTooltip() {
  const { index, lookup } = useWorld();
  const hovered = useExplorerStore((state) => state.hovered);
  const content = useMemo(
    () => (hovered ? tooltipContent(hovered, index, lookup) : null),
    [hovered, index, lookup],
  );
  if (!content) return null;

  return (
    <Html position={content.position} pointerEvents="none" zIndexRange={[20, 0]} aria-hidden="true">
      <div className="pointer-events-none -translate-x-1/2 -translate-y-full pb-2.5">
        <div className="glass animate-fade-in flex max-w-72 items-center gap-2 rounded-md px-2.5 py-1.5 whitespace-nowrap shadow-lg shadow-black/40">
          {content.language ? <LanguageDot language={content.language} /> : null}
          <span className="text-ink truncate font-mono text-xs">{content.title}</span>
          <span className="text-ink-subtle shrink-0 font-mono text-[11px]">{content.detail}</span>
        </div>
      </div>
    </Html>
  );
}
