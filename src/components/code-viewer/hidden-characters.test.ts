import { describe, expect, it } from "vitest";
import {
  codePointLabel,
  escapeHiddenCharacters,
  findHiddenCharacters,
  hasHiddenCharacters,
  splitHiddenCharacters,
  summarizeHiddenCharacters,
} from "./hidden-characters";
import { splitSourceLines, stripByteOrderMark } from "./source-lines";

// Built from code points so this file itself contains no invisible characters.
const char = (...codePoints: number[]) => String.fromCodePoint(...codePoints);
const RLO = char(0x202e);
const LRI = char(0x2066);
const PDI = char(0x2069);
const ZWSP = char(0x200b);
const ZWJ = char(0x200d);
const ZWNJ = char(0x200c);
const BOM = char(0xfeff);

/** The Trojan Source "stretched string" example (CVE-2021-42574). */
const TROJAN_LINE = `if (accessLevel != "user${RLO} ${LRI}// Check if admin${PDI} ${LRI}") {`;

describe("hidden characters", () => {
  it("finds bidi controls with their position, name and kind", () => {
    const found = findHiddenCharacters(TROJAN_LINE);
    expect(found.map((character) => codePointLabel(character.codePoint))).toEqual([
      "U+202E",
      "U+2066",
      "U+2069",
      "U+2066",
    ]);
    expect(found[0]).toEqual({
      index: TROJAN_LINE.indexOf(RLO),
      codePoint: 0x202e,
      name: "Right-to-left override",
      kind: "bidi",
    });
    expect(summarizeHiddenCharacters(TROJAN_LINE)).toEqual({
      bidi: 4,
      invisible: 0,
      first: found[0],
    });
  });

  it("finds zero-width characters and joiners that hide a difference in ASCII text", () => {
    const found = findHiddenCharacters(`const is${ZWSP}Admin = a${ZWJ}b || c${ZWNJ}d;`);
    expect(found.map((character) => [character.name, character.kind])).toEqual([
      ["Zero width space", "invisible"],
      ["Zero width joiner", "invisible"],
      ["Zero width non-joiner", "invisible"],
    ]);
    expect(findHiddenCharacters(`x${char(0x3164)} = 1`)[0]?.name).toBe("Hangul filler");
    expect(findHiddenCharacters(`${BOM}x`)[0]?.name).toBe("Zero width no-break space");
  });

  it("leaves ordinary text alone, including emoji sequences and joiners in scripts that need them", () => {
    expect(hasHiddenCharacters("const answer = 42; // plain ASCII")).toBe(false);
    expect(hasHiddenCharacters("")).toBe(false);
    // Woman technologist: woman + ZWJ + laptop.
    expect(hasHiddenCharacters(`"${char(0x1f469, 0x200d, 0x1f4bb)}"`)).toBe(false);
    // Family with a skin-tone modifier and VS16-carrying heart.
    expect(
      hasHiddenCharacters(char(0x1f469, 0x1f3fd, 0x200d, 0x2764, 0xfe0f, 0x200d, 0x1f468)),
    ).toBe(false);
    // Persian "mikhaham": ZWNJ between Arabic-script letters.
    expect(hasHiddenCharacters(char(0x0645, 0x06cc, 0x200c, 0x062e, 0x0648, 0x0627))).toBe(false);
    // Devanagari: ZWJ after a virama (a combining mark).
    expect(hasHiddenCharacters(char(0x0915, 0x094d, 0x200d, 0x0937))).toBe(false);
    expect(summarizeHiddenCharacters("plain")).toBeNull();
  });

  it("splits text into plain runs and markers", () => {
    expect(splitHiddenCharacters("plain")).toEqual([{ kind: "text", text: "plain" }]);
    expect(splitHiddenCharacters("")).toEqual([]);
    const segments = splitHiddenCharacters(`a${RLO}${RLO}b`);
    expect(segments.map((segment) => segment.kind)).toEqual(["text", "hidden", "hidden", "text"]);
    expect(splitHiddenCharacters(RLO)).toHaveLength(1);
  });

  it("escapes hidden characters for plain-string sinks", () => {
    expect(escapeHiddenCharacters(`evil${RLO}txt.exe`)).toBe("evil[U+202E]txt.exe");
    expect(escapeHiddenCharacters("readme.md")).toBe("readme.md");
    expect(codePointLabel(0x61c)).toBe("U+061C");
  });

  it("treats a leading byte order mark as encoding metadata", () => {
    expect(stripByteOrderMark(`${BOM}const a = 1;`)).toBe("const a = 1;");
    expect(stripByteOrderMark(`a${BOM}`)).toBe(`a${BOM}`);
    expect(splitSourceLines(`${BOM}first\nsecond`)).toEqual(["first", "second"]);
    expect(splitSourceLines(BOM)).toEqual([]);
  });
});
