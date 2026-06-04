import type { TextEdit } from "vscode-languageserver";

export interface SuppressionEditInput {
  /** Full document text (needed for indentation + JSX heuristics). */
  readonly documentText: string | null;
  /** Absolute fs path (drives the comment style for `.tsx` / `.jsx`). */
  readonly fsPath: string;
  /** 1-indexed source line of the diagnostic. */
  readonly line: number;
  /** Fully-qualified rule id, e.g. `react-doctor/no-array-index-as-key`. */
  readonly ruleId: string;
}

const JSX_EXTENSIONS = [".tsx", ".jsx"];

const leadingWhitespace = (lineText: string): string => /^\s*/.exec(lineText)?.[0] ?? "";

/**
 * Heuristic: is the target line most likely JSX, where a `//` comment on
 * the preceding line would be syntactically invalid (inside an element /
 * expression container)? Used only to choose between the two suppression
 * comment styles oxlint / react-doctor both accept.
 */
const isLikelyJsxLine = (lineText: string): boolean => {
  const trimmed = lineText.trim();
  if (trimmed.startsWith("<") || trimmed.startsWith("{/*") || trimmed.startsWith("{")) return true;
  // A bare JSX attribute on its own line, e.g. `onClick={...}` / `value={x}`.
  return /^[A-Za-z_][\w-]*=/.test(trimmed);
};

/**
 * Builds a `// react-doctor-disable-next-line <ruleId>` (or JSX
 * `{/* … *​/}`) edit inserted immediately above the diagnostic line,
 * matching its indentation. The JSX form is chosen for `.tsx` / `.jsx`
 * files when the target line looks like markup so the inserted comment
 * stays syntactically valid.
 */
export const buildSuppressionTextEdit = (input: SuppressionEditInput): TextEdit => {
  const lines = input.documentText !== null ? input.documentText.split("\n") : [];
  const targetLineIndex = Math.max(0, input.line - 1);
  const targetLineText = lines[targetLineIndex] ?? "";
  const indent = leadingWhitespace(targetLineText);

  const isJsxFile = JSX_EXTENSIONS.some((extension) => input.fsPath.endsWith(extension));
  const useJsxComment = isJsxFile && isLikelyJsxLine(targetLineText);

  const comment = useJsxComment
    ? `${indent}{/* react-doctor-disable-next-line ${input.ruleId} */}\n`
    : `${indent}// react-doctor-disable-next-line ${input.ruleId}\n`;

  const insertPosition = { line: targetLineIndex, character: 0 };
  return {
    range: { start: insertPosition, end: insertPosition },
    newText: comment,
  };
};

export interface SuppressionTarget {
  /** 1-indexed source line. */
  readonly line: number;
  readonly ruleId: string;
}

/**
 * Builds one merged suppression edit per source line for a batch of
 * diagnostics, stacking multiple rules above the same line and skipping
 * duplicate (line, rule) pairs. Used by the "suppress all in file" code
 * action and the fix-all command so both produce identical,
 * non-overlapping edits.
 */
export const buildSuppressAllTextEdits = (input: {
  readonly documentText: string | null;
  readonly fsPath: string;
  readonly targets: ReadonlyArray<SuppressionTarget>;
}): TextEdit[] => {
  const seen = new Set<string>();
  const byLine = new Map<number, TextEdit>();
  for (const target of input.targets) {
    const dedupeKey = `${target.line}::${target.ruleId}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    const edit = buildSuppressionTextEdit({
      documentText: input.documentText,
      fsPath: input.fsPath,
      line: target.line,
      ruleId: target.ruleId,
    });
    const existing = byLine.get(target.line);
    if (existing) existing.newText += edit.newText;
    else byLine.set(target.line, edit);
  }
  return [...byLine.values()];
};
