/** Articles and short prepositions that should never end a line of a headline. */
const SHORT_WORD = /(^|\s)(a|an|the|to|of|in|on|by|as|at)\s+/gi;

/**
 * Joins short words to the word after them with a no-break space, so a
 * balanced headline breaks as "From a URL to a universe / in four stages."
 * rather than leaving "to a" hanging at the end of a line.
 */
export function bindShortWords(text: string): string {
  return text.replace(SHORT_WORD, (_match, lead: string, word: string) => `${lead}${word} `);
}
