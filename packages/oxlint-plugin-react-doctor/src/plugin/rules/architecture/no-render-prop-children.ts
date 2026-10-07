import { defineRetiredRule } from "../../utils/define-retired-rule.js";

export const noRenderPropChildren = defineRetiredRule({
  id: "no-render-prop-children",
  severity: "warn",
  category: "Maintainability",
  tags: ["test-noise"],
  title: "Render-prop slots make this component hard to extend",
  recommendation: "Retired: Multiple render slots can be an intentional component API.",
});
