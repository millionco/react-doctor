import { defineRetiredRule } from "../../utils/define-retired-rule.js";

export const noMonotonousPageSpacing = defineRetiredRule({
  id: "no-monotonous-page-spacing",
  severity: "warn",
  category: "Maintainability",
  tags: ["design", "test-noise"],
  title: "Page repeats one spacing value throughout",
  recommendation:
    "Retired: Visual and writing preferences belong in an explicit design guide, not a general defect check.",
});
