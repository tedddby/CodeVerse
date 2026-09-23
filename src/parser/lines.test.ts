import { countLines } from "./lines";
import { exceedsUtf8Bytes, stripByteOrderMark, utf8ByteLength } from "./utf8";

describe("countLines", () => {
  it.each([
    ["", 0],
    ["a", 1],
    ["a\n", 1],
    ["a\nb", 2],
    ["a\nb\n", 2],
    ["\n", 1],
    ["\n\n", 2],
    ["a\r\nb", 2],
    ["a\r\nb\r\n", 2],
    ["a\r\n\r\n", 2],
    ["a\n\nb", 3],
    ["only\rcarriage\rreturns", 1],
    ["\uFEFFfirst\nsecond", 2],
  ])("%j has %i lines", (content, expected) => {
    expect(countLines(content)).toBe(expected);
  });

  it("counts large inputs without splitting", () => {
    const content = "x\n".repeat(250_000);
    expect(countLines(content)).toBe(250_000);
    expect(countLines(`${content}tail`)).toBe(250_001);
  });
});

describe("utf8ByteLength", () => {
  const encoder = new TextEncoder();

  it.each([
    "",
    "ascii only",
    "héllo wörld",
    "世界 — ☃",
    "emoji 😀 and flags 🇯🇵",
    "\uFEFFbom",
    "mixed\r\nlines\n\ttabs",
  ])("matches TextEncoder for %j", (text) => {
    expect(utf8ByteLength(text)).toBe(encoder.encode(text).length);
  });

  it("counts lone surrogates as the 3-byte replacement character", () => {
    expect(utf8ByteLength("a\uD83Db")).toBe(encoder.encode("a\uD83Db").length);
    expect(utf8ByteLength("\uDE00")).toBe(3);
  });
});

describe("exceedsUtf8Bytes", () => {
  it("compares the encoded size, not the string length", () => {
    const text = "é".repeat(10); // 10 code units, 20 bytes
    expect(exceedsUtf8Bytes(text, 19)).toBe(true);
    expect(exceedsUtf8Bytes(text, 20)).toBe(false);
    expect(exceedsUtf8Bytes(text, 10_000)).toBe(false);
  });

  it("short-circuits on the string length", () => {
    expect(exceedsUtf8Bytes("abc", 2)).toBe(true);
    expect(exceedsUtf8Bytes("abc", 3)).toBe(false);
    expect(exceedsUtf8Bytes("", 0)).toBe(false);
  });
});

describe("stripByteOrderMark", () => {
  it("removes only a leading BOM", () => {
    expect(stripByteOrderMark("\uFEFFx")).toBe("x");
    expect(stripByteOrderMark("x\uFEFF")).toBe("x\uFEFF");
    expect(stripByteOrderMark("")).toBe("");
  });
});
