import { highlighter } from "@react-doctor/core";
import { highlightCodeLine } from "./highlight-code-line.js";

interface RenderCodeFrameInput {
  readonly source: string;
  readonly line: number;
  readonly column?: number;
  readonly endLine?: number;
  readonly message?: string;
  readonly linesAbove: number;
  readonly linesBelow: number;
  readonly maximumLineLength: number;
}

const SOURCE_LINE_BREAK_PATTERN = /\r\n|[\n\r\u2028\u2029]/;

export const renderCodeFrame = ({
  source,
  line,
  column,
  endLine,
  message,
  linesAbove,
  linesBelow,
  maximumLineLength,
}: RenderCodeFrameInput): string | null => {
  const sourceLines = source.split(SOURCE_LINE_BREAK_PATTERN);
  if (line < 1 || line > sourceLines.length) return null;
  const offendingLine = sourceLines[line - 1];
  if (offendingLine === undefined || offendingLine.length > maximumLineLength) return null;

  const lastMarkedLine = Math.min(Math.max(endLine ?? line, line), sourceLines.length);
  const firstDisplayedLine = Math.max(line - linesAbove, 1);
  const lastDisplayedLine = Math.min(lastMarkedLine + linesBelow, sourceLines.length);
  const lineNumberWidth = String(lastDisplayedLine).length;
  const hasCaret = lastMarkedLine === line && column !== undefined;
  const outputLines: string[] = [];

  if (message && !hasCaret) {
    outputLines.push(`${" ".repeat(lineNumberWidth + 2)}${highlighter.error(message)}`);
  }

  for (
    let displayedLineNumber = firstDisplayedLine;
    displayedLineNumber <= lastDisplayedLine;
    displayedLineNumber += 1
  ) {
    const sourceLine = sourceLines[displayedLineNumber - 1] ?? "";
    const isMarked = displayedLineNumber >= line && displayedLineNumber <= lastMarkedLine;
    const gutter = ` ${String(displayedLineNumber).padStart(lineNumberWidth)} |`;
    const marker = isMarked ? highlighter.error(">") : " ";
    outputLines.push(
      `${marker}${highlighter.dim(gutter)}${sourceLine.length > 0 ? ` ${highlightCodeLine(sourceLine)}` : ""}`,
    );

    if (isMarked && hasCaret) {
      const markerSpacing = sourceLine.slice(0, Math.max(column - 1, 0)).replace(/[^\t]/g, " ");
      const emptyGutter = gutter.replace(/\d/g, " ");
      const markerMessage = message ? ` ${highlighter.error(message)}` : "";
      outputLines.push(
        ` ${highlighter.dim(emptyGutter)} ${markerSpacing}${highlighter.error("^")}${markerMessage}`,
      );
    }
  }

  return outputLines.join("\n");
};
