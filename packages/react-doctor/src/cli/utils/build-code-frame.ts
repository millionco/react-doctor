import fs from "node:fs";
import path from "node:path";
import { codeFrameColumns } from "@babel/code-frame";
import {
  CODE_FRAME_LINES_ABOVE,
  CODE_FRAME_LINES_BELOW,
  CODE_FRAME_MAX_LINE_LENGTH_CHARS,
} from "@react-doctor/core";

interface CodeFrameInput {
  readonly filePath: string;
  readonly line: number;
  readonly column: number;
  readonly rootDirectory: string;
  // When set (and greater than `line`), the frame marks the whole
  // `line`..`endLine` range — used to batch several same-file sites of one
  // rule into a single spanning frame instead of near-duplicate boxes.
  readonly endLine?: number;
  // Short label rendered inline at the caret (e.g. the rule title). Keep
  // it brief — babel prints it right after the `^`.
  readonly message?: string;
}

/**
 * Renders a syntax-highlighted source excerpt around a diagnostic site
 * with a caret pointing at the offending column. Returns null when the
 * file can't be read (e.g. multi-project summaries where paths are
 * resolved against a different cwd), so callers can fall back to the
 * bare `file:line` reference instead of failing the whole render.
 */
export const buildCodeFrame = (input: CodeFrameInput): string | null => {
  if (input.line <= 0) return null;

  const absolutePath = path.isAbsolute(input.filePath)
    ? input.filePath
    : path.resolve(input.rootDirectory || ".", input.filePath);

  let source: string;
  try {
    source = fs.readFileSync(absolutePath, "utf8");
  } catch {
    return null;
  }

  // A single huge line (minified output, a giant inline data literal)
  // only renders an unreadable wall of text, so skip the frame and let
  // the caller fall back to the bare `file:line` reference.
  const offendingLine = source.split("\n", input.line)[input.line - 1] ?? "";
  if (offendingLine.length > CODE_FRAME_MAX_LINE_LENGTH_CHARS) return null;

  // A spanning frame marks every line in the range and has no single
  // caret column; a single-site frame points the caret at the column.
  const isRange = input.endLine != null && input.endLine > input.line;
  const location = isRange
    ? { start: { line: input.line }, end: { line: input.endLine! } }
    : { start: { line: input.line, column: input.column > 0 ? input.column : undefined } };

  return codeFrameColumns(source, location, {
    highlightCode: true,
    linesAbove: CODE_FRAME_LINES_ABOVE,
    linesBelow: CODE_FRAME_LINES_BELOW,
    ...(input.message ? { message: input.message } : {}),
  });
};
