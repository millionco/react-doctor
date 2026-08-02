import { highlighter } from "@react-doctor/core";
import { resolveMeasureWidth } from "./resolve-measure-width.js";
import { wrapTextToWidth } from "./wrap-indented-text.js";

const FOOTER_DESCRIPTION_INDENT = "  ";

export const buildFooterDescriptionLines = (description: string): string[] => {
  const wrapWidth = resolveMeasureWidth(FOOTER_DESCRIPTION_INDENT.length);
  return wrapTextToWidth(description, wrapWidth).map((line) =>
    highlighter.dim(`${FOOTER_DESCRIPTION_INDENT}${line}`),
  );
};
