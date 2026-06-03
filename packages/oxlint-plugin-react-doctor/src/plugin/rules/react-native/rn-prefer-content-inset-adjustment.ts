import { defineRetiredRule } from "../../utils/define-retired-rule.js";

export const rnPreferContentInsetAdjustment = defineRetiredRule({
  id: "rn-prefer-content-inset-adjustment",
  title: "Manual safe-area inset adjustment",
  tags: ["test-noise"],
  requires: ["react-native"],
  severity: "warn",
  recommendation:
    "Prefer native content inset adjustment only when it replaces manual inset plumbing; SafeAreaView wrappers are valid and intentionally ignored.",
});
