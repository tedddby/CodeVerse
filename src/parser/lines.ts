/**
 * Counts the lines of a text file the way editors and `git` do.
 *
 * - A line is terminated by "\n", so Windows "\r\n" endings count once.
 * - A final line without a terminator still counts ("a\nb" has 2 lines).
 * - A trailing terminator does not open a new line ("a\n" has 1 line).
 * - A lone "\r" is not a terminator, which keeps the count consistent with the
 *   row numbers tree-sitter reports for symbols.
 *
 * "" -> 0, "a" -> 1, "a\n" -> 1, "a\nb" -> 2, "a\r\nb\r\n" -> 2, "\n\n" -> 2.
 */
export function countLines(content: string): number {
  if (content.length === 0) return 0;
  let terminators = 0;
  let index = content.indexOf("\n");
  while (index !== -1) {
    terminators += 1;
    index = content.indexOf("\n", index + 1);
  }
  return content.endsWith("\n") ? terminators : terminators + 1;
}
