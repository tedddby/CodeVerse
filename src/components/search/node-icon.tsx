import {
  Blocks,
  Box,
  FileCode,
  Folder,
  Hash,
  ListTree,
  Package,
  Puzzle,
  Shapes,
  SquareFunction,
  Type,
  Variable,
  type LucideIcon,
} from "lucide-react";
import type { NodeKind, SymbolKind } from "@/graph/model/types";
import { cn } from "@/lib/utils/cn";

const SYMBOL_ICONS: Record<SymbolKind, LucideIcon> = {
  function: SquareFunction,
  method: SquareFunction,
  class: Box,
  interface: Shapes,
  type: Type,
  enum: ListTree,
  struct: Blocks,
  trait: Puzzle,
  module: Package,
  constant: Hash,
  variable: Variable,
};

/** Accent per symbol family: callables in signal, types in ion, values muted. */
const SYMBOL_TONES: Record<SymbolKind, string> = {
  function: "text-signal",
  method: "text-signal",
  class: "text-ion",
  interface: "text-ion",
  type: "text-ion",
  enum: "text-ion",
  struct: "text-ion",
  trait: "text-ion",
  module: "text-ink-muted",
  constant: "text-ink-muted",
  variable: "text-ink-muted",
};

export const SYMBOL_KIND_LABELS: Record<SymbolKind, string> = {
  function: "Function",
  method: "Method",
  class: "Class",
  interface: "Interface",
  type: "Type",
  enum: "Enum",
  struct: "Struct",
  trait: "Trait",
  module: "Module",
  constant: "Constant",
  variable: "Variable",
};

export interface NodeIconProps {
  kind: NodeKind;
  symbolKind?: SymbolKind;
  className?: string;
}

/** Decorative icon for a directory, file or symbol (aria-hidden). */
export function NodeIcon({ kind, symbolKind, className }: NodeIconProps) {
  if (kind === "directory") {
    return (
      <Folder aria-hidden="true" className={cn("text-ink-muted size-4 shrink-0", className)} />
    );
  }
  if (kind === "file") {
    return (
      <FileCode aria-hidden="true" className={cn("text-ink-muted size-4 shrink-0", className)} />
    );
  }
  const Icon = symbolKind ? SYMBOL_ICONS[symbolKind] : SquareFunction;
  const tone = symbolKind ? SYMBOL_TONES[symbolKind] : "text-signal";
  return <Icon aria-hidden="true" className={cn("size-4 shrink-0", tone, className)} />;
}
