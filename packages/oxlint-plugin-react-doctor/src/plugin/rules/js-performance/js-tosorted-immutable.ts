import { defineRetiredRule } from "../../utils/define-retired-rule.js";

export const jsTosortedImmutable = defineRetiredRule({
  id: "js-tosorted-immutable",
  severity: "warn",
  category: "Performance",
  disabledWhen: ["react-native", "pre-es2023"],
  tags: ["test-noise"],
  title: "Spread copy before sort()",
  recommendation:
    "Retired: Both sorted-copy forms create an array. Prefer one only for an explicit compatibility or measured performance reason.",
});
