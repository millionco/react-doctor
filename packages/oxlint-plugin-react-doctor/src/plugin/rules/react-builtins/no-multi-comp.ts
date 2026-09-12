import { defineRetiredRule } from "../../utils/define-retired-rule.js";

export const noMultiComp = defineRetiredRule({
  id: "no-multi-comp",
  severity: "warn",
  category: "Maintainability",
  requires: ["react"],
  title: "Multiple components in one file",
  recommendation:
    "Retired: Component count does not establish that splitting a module improves maintenance.",
});
