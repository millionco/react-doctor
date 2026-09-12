import { defineRetiredRule } from "../../utils/define-retired-rule.js";

export const noItalicSerifDisplayHeading = defineRetiredRule({
  id: "no-italic-serif-display-heading",
  severity: "warn",
  category: "Maintainability",
  tags: ["design", "test-noise"],
  title: "Display heading combines italic serif styling",
  recommendation:
    "Retired: Visual and writing preferences belong in an explicit design guide, not a general defect check.",
});
