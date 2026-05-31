import { highlighter } from "@react-doctor/core";

// The ANSI escape introducer (built from its char code so the SGR patterns
// below don't embed a control character in a regex literal).
const ESCAPE = String.fromCharCode(0x1b);
// Matches SGR color escapes so width is measured on the VISIBLE text — a
// syntax-highlighted code frame is full of these, and counting them would
// misalign the right border.
const ANSI_ESCAPE_PATTERN = new RegExp(`${ESCAPE}\\[[0-9;]*m`, "g");
const ANSI_LEADING_ESCAPE_PATTERN = new RegExp(`^${ESCAPE}\\[[0-9;]*m`);
const ANSI_RESET = `${ESCAPE}[0m`;
const ELLIPSIS = "…";

const visibleWidth = (line: string): number => line.replace(ANSI_ESCAPE_PATTERN, "").length;

// Clips a (possibly ANSI-colored) line to `maxVisibleWidth` visible columns.
// Color escapes are copied through without counting toward width, and a
// trailing reset + ellipsis is appended so a clipped frame line still fits
// the box exactly and never bleeds a dangling color onto the border.
const truncateToVisibleWidth = (line: string, maxVisibleWidth: number): string => {
  if (visibleWidth(line) <= maxVisibleWidth) return line;
  const keepWidth = Math.max(0, maxVisibleWidth - ELLIPSIS.length);
  let result = "";
  let keptVisible = 0;
  let cursor = 0;
  while (cursor < line.length && keptVisible < keepWidth) {
    const escapeMatch = ANSI_LEADING_ESCAPE_PATTERN.exec(line.slice(cursor));
    if (escapeMatch) {
      result += escapeMatch[0];
      cursor += escapeMatch[0].length;
      continue;
    }
    result += line[cursor];
    keptVisible += 1;
    cursor += 1;
  }
  return `${result}${ANSI_RESET}${ELLIPSIS}`;
};

// Wraps a (possibly ANSI-colored) multi-line block in a dim box of a FIXED
// inner width so every code frame in the report renders the exact same size:
// shorter lines are padded, longer ones clipped with an ellipsis. Uses the
// same box-drawing glyphs as the score header.
export const boxText = (content: string, innerWidth: number): string => {
  const horizontalRule = highlighter.dim("─".repeat(innerWidth + 2));
  const side = highlighter.dim("│");
  const body = content.split("\n").map((rawLine) => {
    const line = truncateToVisibleWidth(rawLine, innerWidth);
    return `${side} ${line}${" ".repeat(innerWidth - visibleWidth(line))} ${side}`;
  });
  return [
    `${highlighter.dim("┌")}${horizontalRule}${highlighter.dim("┐")}`,
    ...body,
    `${highlighter.dim("└")}${horizontalRule}${highlighter.dim("┘")}`,
  ].join("\n");
};
