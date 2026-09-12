import { defineRetiredRule } from "../../utils/define-retired-rule.js";

export const rnNoSingleElementStyleArray = defineRetiredRule({
  id: "rn-no-single-element-style-array",
  severity: "warn",
  category: "Bugs",
  requires: ["react-native"],
  tags: ["react-native", "test-noise"],
  title: "Single-element style array adds wasted allocation",
  recommendation:
    "Retired: A one-item style array does not establish a meaningful performance cost.",
});
