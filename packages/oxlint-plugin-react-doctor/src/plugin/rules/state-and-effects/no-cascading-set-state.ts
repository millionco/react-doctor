import { defineRetiredRule } from "../../utils/define-retired-rule.js";

export const noCascadingSetState = defineRetiredRule({
  id: "no-cascading-set-state",
  title: "Multiple setState calls in one effect",
  severity: "warn",
  tags: ["test-noise"],
  recommendation:
    "Retired: React batches synchronous state updates from one effect into the same follow-up commit, so setter count does not prove repeated redraws.",
});
