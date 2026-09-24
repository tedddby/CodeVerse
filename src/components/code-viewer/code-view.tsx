"use client";

import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { cn } from "@/lib/utils/cn";
import { formatInteger } from "@/lib/utils/format";
import { CODEVERSE_THEME_COLORS } from "./codeverse-theme";
import type { HighlightedLine } from "./highlighter";
import { revealHiddenCharacters } from "./revealed-text";
import {
  MAX_RENDERED_LINE_LENGTH,
  maxVisualWidth,
  scrollTopForLine,
  TAB_SIZE,
  visibleLineRange,
} from "./source-lines";

/** Fixed row height in CSS pixels; virtualization depends on it. */
export const LINE_HEIGHT = 20;
const OVERSCAN = 30;

export interface ScrollRequest {
  line: number;
  /** Changes whenever the same line should be scrolled to again. */
  key: string;
}

export interface CodeViewProps {
  lines: readonly string[];
  tokens: readonly HighlightedLine[];
  /** 1-based inclusive range to emphasize (the requested symbol/lines). */
  highlightStart?: number;
  highlightEnd?: number;
  scrollRequest: ScrollRequest | null;
  label: string;
  /** Id of an element describing the listing (the hidden-characters notice). */
  describedBy?: string;
}

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Virtualized, read-only code listing: fixed-height rows, only the visible lines
 * (plus overscan) are in the DOM, so 20k-line files scroll smoothly. Tokens are
 * rendered as plain React spans — never as HTML — with bidi controls and
 * zero-width characters shown as visible markers (see hidden-characters.ts).
 */
export function CodeView({
  lines,
  tokens,
  highlightStart,
  highlightEnd,
  scrollRequest,
  label,
  describedBy,
}: CodeViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(600);

  useIsomorphicLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const measure = () => setViewportHeight(element.clientHeight || 600);
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useIsomorphicLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element || !scrollRequest) return;
    const top = scrollTopForLine(
      scrollRequest.line,
      LINE_HEIGHT,
      element.clientHeight || 600,
      lines.length,
    );
    element.scrollTop = top;
    // Keep the virtual window in sync even where scroll events don't fire (tests, hidden tabs).
    setScrollTop(top);
  }, [scrollRequest, lines.length]);

  const gutterDigits = String(Math.max(1, lines.length)).length;
  const contentColumns = useMemo(() => maxVisualWidth(lines), [lines]);
  const range = visibleLineRange(scrollTop, viewportHeight, LINE_HEIGHT, lines.length, OVERSCAN);

  const rows = [];
  for (let index = range.start; index < range.end; index += 1) {
    const lineNumber = index + 1;
    const emphasized =
      highlightStart !== undefined &&
      lineNumber >= highlightStart &&
      lineNumber <= (highlightEnd ?? highlightStart);
    rows.push(
      <CodeRow
        key={index}
        lineNumber={lineNumber}
        text={lines[index] ?? ""}
        tokens={tokens[index]}
        emphasized={emphasized}
        gutterDigits={gutterDigits}
      />,
    );
  }

  const style: CSSProperties = {
    height: lines.length * LINE_HEIGHT,
    minWidth: `calc(${gutterDigits + 3}ch + ${contentColumns + 6}ch)`,
    tabSize: TAB_SIZE,
  };

  return (
    <div
      ref={scrollRef}
      role="region"
      aria-label={label}
      aria-describedby={describedBy}
      tabIndex={0}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      className="relative min-h-0 flex-1 overflow-auto overscroll-contain font-mono text-[12.5px] focus-visible:outline-offset-[-2px]"
      style={{
        backgroundColor: CODEVERSE_THEME_COLORS.background,
        color: CODEVERSE_THEME_COLORS.foreground,
      }}
    >
      <div className="relative" style={style}>
        <div
          className="absolute inset-x-0 top-0"
          style={{ transform: `translateY(${range.start * LINE_HEIGHT}px)` }}
        >
          {rows}
        </div>
      </div>
    </div>
  );
}

interface CodeRowProps {
  lineNumber: number;
  text: string;
  tokens: HighlightedLine | undefined;
  emphasized: boolean;
  gutterDigits: number;
}

const FONT_STYLE_ITALIC = 1;
const FONT_STYLE_BOLD = 2;
const FONT_STYLE_UNDERLINE = 4;

const CodeRow = memo(function CodeRow({
  lineNumber,
  text,
  tokens,
  emphasized,
  gutterDigits,
}: CodeRowProps) {
  const truncated = text.length > MAX_RENDERED_LINE_LENGTH;
  return (
    <div
      data-line={lineNumber}
      className={cn("flex whitespace-pre", emphasized && "bg-flare/[0.09]")}
      style={{ height: LINE_HEIGHT, lineHeight: `${LINE_HEIGHT}px` }}
    >
      <span
        aria-hidden="true"
        className={cn(
          "sticky left-0 z-10 shrink-0 border-r pr-3 text-right tabular-nums select-none",
          emphasized ? "border-flare/60 text-flare" : "border-line/70 text-ink-subtle/70",
        )}
        style={{
          width: `${gutterDigits + 3}ch`,
          backgroundColor: emphasized
            ? "color-mix(in oklab, #070b13 88%, #ffb454)"
            : CODEVERSE_THEME_COLORS.background,
        }}
      >
        {lineNumber}
      </span>
      <span className="pr-6 pl-4">
        {tokens && !truncated
          ? tokens.map((token, i) => (
              <span
                key={i}
                style={{
                  color: token.color,
                  fontStyle:
                    token.fontStyle && token.fontStyle & FONT_STYLE_ITALIC ? "italic" : undefined,
                  fontWeight:
                    token.fontStyle && token.fontStyle & FONT_STYLE_BOLD ? 600 : undefined,
                  textDecoration:
                    token.fontStyle && token.fontStyle & FONT_STYLE_UNDERLINE
                      ? "underline"
                      : undefined,
                }}
              >
                {revealHiddenCharacters(token.content)}
              </span>
            ))
          : revealHiddenCharacters(truncated ? text.slice(0, MAX_RENDERED_LINE_LENGTH) : text)}
        {truncated ? (
          <span className="border-line-strong text-ink-subtle ml-2 rounded border px-1 font-sans text-[10.5px]">
            +{formatInteger(text.length - MAX_RENDERED_LINE_LENGTH)} characters
          </span>
        ) : null}
      </span>
    </div>
  );
});
