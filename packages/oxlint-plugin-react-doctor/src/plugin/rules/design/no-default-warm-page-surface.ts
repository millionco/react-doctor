import { defineRetiredRule } from "../../utils/define-retired-rule.js";

export const noDefaultWarmPageSurface = defineRetiredRule({
  id: "no-default-warm-page-surface",
  severity: "warn",
  category: "Maintainability",
  tags: ["design", "test-noise"],
  title: "Page defaults to a warm off-white surface",
  recommendation:
    "Retired: Visual and writing preferences belong in an explicit design guide, not a general defect check.",
});
