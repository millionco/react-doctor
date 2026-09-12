import { defineRetiredRule } from "../../utils/define-retired-rule.js";

export const rnPreferReanimated = defineRetiredRule({
  id: "rn-prefer-reanimated",
  severity: "warn",
  category: "Bugs",
  requires: ["react-native"],
  tags: ["react-native", "test-noise"],
  title: "JS-thread animation instead of Reanimated",
  recommendation:
    "Retired: An Animated import does not prove that an animation runs on the JavaScript thread.",
});
