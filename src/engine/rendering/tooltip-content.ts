import type { LayoutLookup } from "@/engine/layout/lookup";
import { layoutSymbolBands } from "@/engine/layout/symbol-bands";
import type { GraphIndex } from "@/graph/model/graph-index";
import type { NodeRef, SymbolNode } from "@/graph/model/types";
import { formatBytes, formatInteger, pluralize } from "@/lib/utils/format";

/**
 * Text and anchor of the hover tooltip for a file, directory or symbol.
 * Plain strings only: repository data is rendered as text, never as markup.
 */

export interface TooltipContent {
  position: [number, number, number];
  title: string;
  detail: string;
  language: string | null;
}

function symbolDetail(symbol: SymbolNode): string {
  const span =
    symbol.endLine > symbol.startLine
      ? `L${symbol.startLine}–${symbol.endLine}`
      : `L${symbol.startLine}`;
  return `${symbol.kind} · ${span}`;
}

export function tooltipContent(
  ref: NodeRef,
  index: GraphIndex,
  lookup: LayoutLookup,
): TooltipContent | null {
  switch (ref.kind) {
    case "file": {
      const file = index.filesById.get(ref.id);
      const building = lookup.buildingsById.get(ref.id);
      if (!file || !building) return null;
      const detail =
        file.status === "binary"
          ? `binary · ${formatBytes(file.size)}`
          : `${file.linesEstimated ? "~" : ""}${pluralize(file.lines, "line")}`;
      return {
        position: [building.x, building.baseY + building.height, building.z],
        title: file.name,
        detail,
        language: file.language,
      };
    }
    case "directory": {
      const directory = index.directoriesById.get(ref.id);
      const district = lookup.districtsById.get(ref.id);
      if (!directory || !district) return null;
      const lines = `${directory.stats.linesEstimated ? "~" : ""}${formatInteger(directory.stats.totalLines)} LOC`;
      return {
        position: [district.x, district.baseY + district.height, district.z],
        title: `${directory.path === "" ? directory.name : directory.path}/`,
        detail: `${pluralize(directory.stats.fileCount, "file")} · ${lines}`,
        language: null,
      };
    }
    case "symbol": {
      const symbol = index.symbolsById.get(ref.id);
      const file = symbol ? index.filesById.get(symbol.fileId) : undefined;
      const building = file ? lookup.buildingsById.get(file.id) : undefined;
      if (!symbol || !file || !building) return null;
      const siblings = file.symbolIds
        .map((id) => index.symbolsById.get(id))
        .filter((s): s is SymbolNode => s !== undefined);
      const band = layoutSymbolBands(file, siblings, building).find(
        (item) => item.id === symbol.id,
      );
      return {
        position: [building.x, band ? band.y1 : building.baseY + building.height, building.z],
        title: symbol.name,
        detail: symbolDetail(symbol),
        language: file.language,
      };
    }
  }
}
