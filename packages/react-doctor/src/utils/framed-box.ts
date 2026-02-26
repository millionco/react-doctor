import {
  SUMMARY_BOX_HORIZONTAL_PADDING_CHARS,
  SUMMARY_BOX_OUTER_INDENT_CHARS,
} from "../constants.js";
import { highlighter } from "./highlighter.js";
import { logger } from "./logger.js";

export interface FramedLine {
  plainText: string;
  renderedText: string;
}

export const createFramedLine = (
  plainText: string,
  renderedText: string = plainText,
): FramedLine => ({
  plainText,
  renderedText,
});

export const renderFramedBoxString = (framedLines: FramedLine[]): string => {
  if (framedLines.length === 0) return "";

  const borderColorizer = highlighter.dim;
  const outerIndent = " ".repeat(SUMMARY_BOX_OUTER_INDENT_CHARS);
  const horizontalPadding = " ".repeat(SUMMARY_BOX_HORIZONTAL_PADDING_CHARS);
  const maximumLineLength = Math.max(
    ...framedLines.map((framedLine) => framedLine.plainText.length),
  );
  const borderLine = "─".repeat(maximumLineLength + SUMMARY_BOX_HORIZONTAL_PADDING_CHARS * 2);

  const lines: string[] = [];
  lines.push(`${outerIndent}${borderColorizer(`┌${borderLine}┐`)}`);

  for (const framedLine of framedLines) {
    const trailingSpaces = " ".repeat(maximumLineLength - framedLine.plainText.length);
    lines.push(
      `${outerIndent}${borderColorizer("│")}${horizontalPadding}${framedLine.renderedText}${trailingSpaces}${horizontalPadding}${borderColorizer("│")}`,
    );
  }

  lines.push(`${outerIndent}${borderColorizer(`└${borderLine}┘`)}`);
  return lines.join("\n");
};

export const printFramedBox = (framedLines: FramedLine[]): void => {
  const rendered = renderFramedBoxString(framedLines);
  if (rendered) {
    logger.log(rendered);
  }
};
