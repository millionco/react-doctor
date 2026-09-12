import { defineRetiredRule } from "../../utils/define-retired-rule.js";

export const preferExplicitVariants = defineRetiredRule({
  id: "prefer-explicit-variants",
  severity: "warn",
  category: "Maintainability",
  tags: ["test-noise", "react-jsx-only"],
  title: "Prefer explicit variant components",
  recommendation:
    "Retired: Boolean branches do not prove that separate variant components are easier to maintain.",
});
