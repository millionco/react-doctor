import { defineRetiredRule } from "../../utils/define-retired-rule.js";

export const rnNoSetNativeProps = defineRetiredRule({
  id: "rn-no-set-native-props",
  severity: "warn",
  category: "Bugs",
  requires: ["react-native"],
  tags: ["react-native"],
  title: "Imperative setNativeProps",
  recommendation: "Retired: React Native supports setNativeProps under the New Architecture.",
});
