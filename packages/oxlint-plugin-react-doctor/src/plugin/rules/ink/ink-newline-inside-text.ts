import { MINIMUM_INK_VERSIONS } from "../../constants/ink.js";
import { defineRetiredRule } from "../../utils/define-retired-rule.js";

export const inkNewlineInsideText = defineRetiredRule({
  id: "ink-newline-inside-text",
  title: "Retired: Ink Newline placement",
  severity: "error",
  minimumInkVersion: MINIMUM_INK_VERSIONS.base,
  recommendation: "No change is required; Ink supports standalone `<Newline>` elements.",
});
