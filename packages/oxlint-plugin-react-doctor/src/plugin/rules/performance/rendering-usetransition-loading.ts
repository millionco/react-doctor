import { defineRetiredRule } from "../../utils/define-retired-rule.js";

export const renderingUsetransitionLoading = defineRetiredRule({
  id: "rendering-usetransition-loading",
  severity: "warn",
  category: "Performance",
  requires: ["react"],
  tags: ["test-noise"],
  title: "Loading useState forces extra render",
  recommendation:
    "Retired: A loading state name does not establish expensive non-urgent work that should use a transition.",
});
