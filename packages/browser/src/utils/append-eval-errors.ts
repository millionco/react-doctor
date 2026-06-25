import type { ConsoleMessageEntry } from "../types.js";

// Append a compact "Errors during eval" section when the driven action triggered
// any page-side errors (console.error or an uncaught throw, both surfaced by the
// console collector as type "error"). Returns the output unchanged when none
// fired, so a clean action stays clean.
export const appendEvalErrors = (output: string, entries: ConsoleMessageEntry[]): string => {
  const errors = entries.filter((entry) => entry.type === "error");
  if (errors.length === 0) return output;
  const lines = errors.map(
    (entry) => `[error] ${entry.text}${entry.location ? ` (${entry.location})` : ""}`,
  );
  return `${output}\n\n# Errors during eval\n${lines.join("\n")}`;
};
