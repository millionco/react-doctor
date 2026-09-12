import { defineRetiredRule } from "../../utils/define-retired-rule.js";

export const hooksNoNanInDeps = defineRetiredRule({
  id: "hooks-no-nan-in-deps",
  severity: "warn",
  category: "Bugs",
  requires: ["react"],
  title: "NaN in a hook dependency array",
  recommendation:
    "Retired: React compares dependencies with Object.is. A stable NaN dependency does not establish a defect.",
});
