import { defineRetiredRule } from "../../utils/define-retired-rule.js";

export const noPolymorphicChildren = defineRetiredRule({
  id: "no-polymorphic-children",
  severity: "warn",
  category: "Maintainability",
  title: "Children type checked at runtime",
  recommendation:
    "Retired: Accepting text and element children can be an intentional component contract.",
});
