/** Textareas expose LF even when the Markdown file uses CRLF. */
export function sourceInputValue(markdown: string) {
  return markdown.replace(/\r\n?/g, "\n");
}

/** Keep untouched source (including mixed line endings) byte-for-byte intact. */
export function applySourceInput(before: string, input: string) {
  const previous = sourceInputValue(before);
  if (previous === input) return before;
  let start = 0, tail = 0;
  while (start < previous.length && start < input.length && previous[start] === input[start]) start++;
  while (tail < previous.length - start && tail < input.length - start && previous[previous.length - tail - 1] === input[input.length - tail - 1]) tail++;
  const rawOffset = (offset: number) => {
    let raw = 0;
    for (let i = 0; i < offset; i++, raw++) {
      if (before[raw] === "\r" && before[raw + 1] === "\n") raw++;
    }
    return raw;
  };
  const newline = before.match(/\r\n|\r|\n/)?.[0] ?? "\n";
  return before.slice(0, rawOffset(start))
    + input.slice(start, input.length - tail).replace(/\n/g, newline)
    + before.slice(rawOffset(previous.length - tail));
}
