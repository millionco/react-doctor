import { defineRetiredRule } from "../../utils/define-retired-rule.js";

export const noChildrenProp = defineRetiredRule({
  id: "no-children-prop",
  severity: "warn",
  category: "Bugs",
  requires: ["react"],
  title: "Children passed as a prop",
  recommendation:
    "Retired: Passing children explicitly is valid when it does not conflict with nested children.",
});
