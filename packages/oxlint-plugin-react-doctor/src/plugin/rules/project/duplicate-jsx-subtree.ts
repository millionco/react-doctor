import { defineRule } from "../../utils/define-rule.js";

export const duplicateJsxSubtree = defineRule({
  id: "duplicate-jsx-subtree",
  title: "Duplicated JSX structure",
  severity: "warn",
  execution: "project",
  recommendation:
    "Extract a shared component when the repeated JSX trees represent the same UI concept and should evolve together.",
});
