import { Fragment, type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";
import { codePointLabel, splitHiddenCharacters, type HiddenCharacter } from "./hidden-characters";

/** Visible stand-in for a hidden character: its code point in a tinted box. */
export function HiddenCharacterMarker({
  character,
  className,
}: {
  character: HiddenCharacter;
  className?: string;
}) {
  const label = codePointLabel(character.codePoint);
  return (
    <span
      data-hidden-character={label}
      title={`${character.name} (${label}), a hidden character`}
      className={cn(
        "bg-warn/15 text-warn ring-warn/40 mx-px rounded-[3px] px-[3px] font-mono text-[0.8em] ring-1 ring-inset",
        className,
      )}
    >
      {label}
    </span>
  );
}

/**
 * Renders untrusted text with every hidden character (bidi controls,
 * zero-width characters) replaced by a visible marker, so it can neither
 * reorder the surrounding text nor hide a difference. Text without such
 * characters is returned unchanged.
 */
export function revealHiddenCharacters(text: string): ReactNode {
  const segments = splitHiddenCharacters(text);
  if (!segments.some((segment) => segment.kind === "hidden")) return text;
  return segments.map((segment, i) =>
    segment.kind === "text" ? (
      <Fragment key={i}>{segment.text}</Fragment>
    ) : (
      <HiddenCharacterMarker key={i} character={segment.character} />
    ),
  );
}
