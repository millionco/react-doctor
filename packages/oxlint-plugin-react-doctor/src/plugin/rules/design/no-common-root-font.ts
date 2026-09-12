import { defineRetiredRule } from "../../utils/define-retired-rule.js";

export const noCommonRootFont = defineRetiredRule({
  id: "no-common-root-font",
  severity: "warn",
  category: "Maintainability",
  tags: ["design", "test-noise"],
  title: "Page root uses a generic default font choice",
  recommendation:
    "Retired: Visual and writing preferences belong in an explicit design guide, not a general defect check.",
});
