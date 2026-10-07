import { defineRetiredRule } from "../../utils/define-retired-rule.js";

export const noThreePeriodEllipsis = defineRetiredRule({
  id: "design-no-three-period-ellipsis",
  severity: "warn",
  category: "Maintainability",
  requires: ["react"],
  tags: ["design", "test-noise"],
  title: "Three dots instead of ellipsis",
  recommendation:
    "Retired: Visual and writing preferences belong in an explicit design guide, not a general defect check.",
});
