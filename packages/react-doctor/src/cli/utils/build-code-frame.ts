import * as fs from "node:fs";
import {
  CODE_FRAME_LINES_ABOVE,
  CODE_FRAME_LINES_BELOW,
  CODE_FRAME_MAX_LINE_LENGTH_CHARS,
} from "@react-doctor/core";
import { renderCodeFrame } from "./render-code-frame.js";
import { resolveAbsolutePath } from "./resolve-absolute-path.js";

interface CodeFrameInput {
  readonly filePath: string;
  readonly line: number;
  readonly column: number;
  readonly rootDirectory: string;
  // When set (and greater than `line`), the frame marks the whole
  // `line`..`endLine` range — used to batch several same-file sites of one
  // rule into a single spanning frame instead of near-duplicate boxes.
  readonly endLine?: number;
  // Short label rendered inline at the caret (e.g. the rule title).
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

  const absolutePath = resolveAbsolutePath(input.filePath, input.rootDirectory);

  let source: string;
  try {
    source = fs.readFileSync(absolutePath, "utf8");
  } catch {
    return null;
  }

  const endLine = input.endLine != null && input.endLine > input.line ? input.endLine : undefined;
  return renderCodeFrame({
    source,
    line: input.line,
    column: endLine === undefined && input.column > 0 ? input.column : undefined,
    endLine,
    message: input.message,
    linesAbove: CODE_FRAME_LINES_ABOVE,
    linesBelow: CODE_FRAME_LINES_BELOW,
    maximumLineLength: CODE_FRAME_MAX_LINE_LENGTH_CHARS,
  });
};
