import { defineRetiredRule } from "../../utils/define-retired-rule.js";

export const noEmDashInJsxText = defineRetiredRule({
  id: "design-no-em-dash-in-jsx-text",
  severity: "warn",
  category: "Maintainability",
  requires: ["react"],
  tags: ["design", "test-noise"],
  title: "Em dash in JSX text",
  recommendation:
    "Retired: Visual and writing preferences belong in an explicit design guide, not a general defect check.",
});
