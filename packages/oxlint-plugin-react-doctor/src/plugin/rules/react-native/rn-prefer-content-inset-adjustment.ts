import { defineRetiredRule } from "../../utils/define-retired-rule.js";

export const rnPreferContentInsetAdjustment = defineRetiredRule({
  id: "rn-prefer-content-inset-adjustment",
  title: "Manual safe-area insets can duplicate offsets",
  tags: ["test-noise"],
  requires: ["react-native"],
  severity: "warn",
  recommendation:
    "Retired: SafeAreaView wrappers are valid; prefer native content inset adjustment only when manual inset plumbing causes scroll jumps or duplicated safe-area offsets.",
});
