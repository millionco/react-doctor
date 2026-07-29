import { highlighter } from "../../core/core-presentation.js";
import { resolveMeasureWidth } from "./resolve-measure-width.js";

const DIVIDER_INDENT = "  ";

export const buildSectionDivider = (): string =>
  highlighter.dim(`${DIVIDER_INDENT}${"─".repeat(resolveMeasureWidth(DIVIDER_INDENT.length))}`);
