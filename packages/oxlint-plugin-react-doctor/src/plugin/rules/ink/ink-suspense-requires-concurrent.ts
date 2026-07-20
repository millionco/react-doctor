import { MINIMUM_INK_VERSIONS } from "../../constants/ink.js";
import { defineRetiredRule } from "../../utils/define-retired-rule.js";

export const inkSuspenseRequiresConcurrent = defineRetiredRule({
  id: "ink-suspense-requires-concurrent",
  title: "Retired: Ink Suspense rendering mode",
  severity: "error",
  minimumInkVersion: MINIMUM_INK_VERSIONS.concurrent,
  recommendation: "No change is required; Ink can render Suspense fallbacks without concurrency.",
});
