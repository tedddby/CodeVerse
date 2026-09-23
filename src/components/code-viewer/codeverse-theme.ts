import type { ThemeRegistration } from "shiki/core";

/**
 * "CodeVerse Dark" — a restrained TextMate theme harmonized with the app palette
 * (deep-space background, cyan "signal" for functions, violet "ion" for
 * keywords). Amber is deliberately absent: it is reserved for selection, which
 * the viewer uses to highlight the requested line range.
 */
export const CODEVERSE_THEME_NAME = "codeverse-dark";

export const CODEVERSE_THEME_COLORS = {
  background: "#070b13",
  foreground: "#d5deea",
  comment: "#5f6d85",
  keyword: "#b3a6ff",
  function: "#66dcf5",
  type: "#8fb8ff",
  string: "#8ee0b0",
  number: "#f5a3c3",
  constant: "#f5a3c3",
  variable: "#d5deea",
  property: "#c3cfdf",
  parameter: "#e2d3c1",
  punctuation: "#8795ab",
  tag: "#79c3ff",
  attribute: "#b3a6ff",
  regexp: "#ff9f8f",
  heading: "#66dcf5",
  invalid: "#ff6b7a",
} as const;

const c = CODEVERSE_THEME_COLORS;

export const CODEVERSE_THEME: ThemeRegistration = {
  name: CODEVERSE_THEME_NAME,
  displayName: "CodeVerse Dark",
  type: "dark",
  fg: c.foreground,
  bg: c.background,
  colors: {
    "editor.background": c.background,
    "editor.foreground": c.foreground,
  },
  settings: [
    { settings: { foreground: c.foreground, background: c.background } },
    {
      scope: ["comment", "punctuation.definition.comment", "string.comment"],
      settings: { foreground: c.comment, fontStyle: "italic" },
    },
    {
      scope: [
        "keyword",
        "keyword.control",
        "storage",
        "storage.type",
        "storage.modifier",
        "keyword.operator.new",
        "keyword.operator.expression",
        "keyword.operator.logical.python",
        "variable.language.this",
        "variable.language.self",
        "variable.language.super",
      ],
      settings: { foreground: c.keyword },
    },
    {
      scope: [
        "keyword.operator",
        "punctuation",
        "meta.brace",
        "punctuation.separator",
        "punctuation.terminator",
      ],
      settings: { foreground: c.punctuation },
    },
    {
      scope: [
        "entity.name.function",
        "support.function",
        "meta.function-call entity.name.function",
        "variable.function",
        "entity.name.method",
      ],
      settings: { foreground: c.function },
    },
    {
      scope: [
        "entity.name.type",
        "entity.name.class",
        "entity.name.namespace",
        "entity.name.struct",
        "entity.name.enum",
        "entity.name.interface",
        "entity.other.inherited-class",
        "support.type",
        "support.class",
        "storage.type.primitive",
        "storage.type.built-in",
      ],
      settings: { foreground: c.type },
    },
    {
      scope: [
        "string",
        "string.quoted",
        "string.template",
        "punctuation.definition.string",
        "markup.inline.raw",
      ],
      settings: { foreground: c.string },
    },
    {
      scope: ["string.regexp", "constant.other.character-class.regexp"],
      settings: { foreground: c.regexp },
    },
    {
      scope: ["constant.character.escape", "constant.other.placeholder"],
      settings: { foreground: c.regexp },
    },
    {
      scope: [
        "constant.numeric",
        "constant.language",
        "constant.other",
        "support.constant",
        "variable.other.constant",
      ],
      settings: { foreground: c.constant },
    },
    {
      scope: ["variable", "variable.other", "meta.definition.variable"],
      settings: { foreground: c.variable },
    },
    {
      scope: [
        "variable.other.property",
        "variable.other.object.property",
        "support.variable.property",
        "meta.object-literal.key",
      ],
      settings: { foreground: c.property },
    },
    { scope: ["variable.parameter", "meta.parameter"], settings: { foreground: c.parameter } },
    { scope: ["entity.name.tag", "punctuation.definition.tag"], settings: { foreground: c.tag } },
    {
      scope: ["entity.other.attribute-name", "support.type.property-name"],
      settings: { foreground: c.attribute },
    },
    {
      scope: ["support.type.property-name.json", "support.type.property-name.toml"],
      settings: { foreground: c.type },
    },
    { scope: ["entity.name.tag.yaml"], settings: { foreground: c.type } },
    {
      scope: ["meta.decorator", "entity.name.function.decorator", "punctuation.decorator"],
      settings: { foreground: c.keyword },
    },
    {
      scope: ["markup.heading", "entity.name.section"],
      settings: { foreground: c.heading, fontStyle: "bold" },
    },
    { scope: ["markup.bold"], settings: { fontStyle: "bold" } },
    { scope: ["markup.italic"], settings: { fontStyle: "italic" } },
    { scope: ["markup.underline.link", "string.other.link"], settings: { foreground: c.type } },
    { scope: ["markup.list", "punctuation.definition.list"], settings: { foreground: c.keyword } },
    { scope: ["markup.inserted"], settings: { foreground: c.string } },
    { scope: ["markup.deleted"], settings: { foreground: c.invalid } },
    { scope: ["invalid", "invalid.illegal"], settings: { foreground: c.invalid } },
  ],
};
