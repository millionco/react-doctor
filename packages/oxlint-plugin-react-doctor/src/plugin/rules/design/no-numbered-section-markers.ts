import { defineRetiredRule } from "../../utils/define-retired-rule.js";

export const noNumberedSectionMarkers = defineRetiredRule({
  id: "no-numbered-section-markers",
  severity: "warn",
  category: "Maintainability",
  tags: ["design", "test-noise"],
  title: "Styled numbers are used as section decoration",
  recommendation:
    "Retired: Visual and writing preferences belong in an explicit design guide, not a general defect check.",
});
