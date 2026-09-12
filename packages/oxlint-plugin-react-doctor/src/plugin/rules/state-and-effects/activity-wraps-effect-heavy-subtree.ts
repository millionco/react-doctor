import { defineRetiredRule } from "../../utils/define-retired-rule.js";

export const activityWrapsEffectHeavySubtree = defineRetiredRule({
  id: "activity-wraps-effect-heavy-subtree",
  severity: "warn",
  category: "Bugs",
  requires: ["react", "react:19.2"],
  title: "Activity wraps an effect-heavy subtree",
  recommendation:
    "Retired: Activity intentionally cleans up effects while hidden and preserves component state.",
});
