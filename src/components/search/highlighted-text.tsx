import { revealHiddenCharacters } from "@/components/code-viewer/revealed-text";
import { cn } from "@/lib/utils/cn";

export interface HighlightedTextProps {
  text: string;
  /** Indices of characters to emphasize (ascending or not; duplicates are ignored). */
  matches: readonly number[];
  className?: string;
  matchClassName?: string;
}

interface Segment {
  text: string;
  matched: boolean;
}

/** Splits `text` into alternating matched / unmatched runs. */
export function splitByMatches(text: string, matches: readonly number[]): Segment[] {
  if (matches.length === 0) return text ? [{ text, matched: false }] : [];
  const matched = new Set(matches);
  const segments: Segment[] = [];
  let current = "";
  let currentMatched = matched.has(0);
  for (let i = 0; i < text.length; i += 1) {
    const isMatch = matched.has(i);
    if (isMatch !== currentMatched && current) {
      segments.push({ text: current, matched: currentMatched });
      current = "";
    }
    currentMatched = isMatch;
    current += text.charAt(i);
  }
  if (current) segments.push({ text: current, matched: currentMatched });
  return segments;
}

/**
 * Renders text with fuzzy-matched characters emphasized. Text is rendered as
 * text only, with bidi controls and zero-width characters shown as markers.
 */
export function HighlightedText({
  text,
  matches,
  className,
  matchClassName,
}: HighlightedTextProps) {
  const segments = splitByMatches(text, matches);
  return (
    <span className={className}>
      {segments.map((segment, i) =>
        segment.matched ? (
          <mark key={i} className={cn("text-signal bg-transparent font-semibold", matchClassName)}>
            {revealHiddenCharacters(segment.text)}
          </mark>
        ) : (
          <span key={i}>{revealHiddenCharacters(segment.text)}</span>
        ),
      )}
    </span>
  );
}
