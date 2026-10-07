import { defineRetiredRule } from "../../utils/define-retired-rule.js";

export const noMultiComponentFile = defineRetiredRule({
  id: "no-multi-component-file",
  severity: "warn",
  category: "Maintainability",
  requires: ["react"],
  title: "Crowded component file",
  recommendation:
    "Retired: Component count does not establish that splitting a module improves maintenance.",
});
