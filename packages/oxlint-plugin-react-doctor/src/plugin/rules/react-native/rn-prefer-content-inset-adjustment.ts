import { defineRule } from "../../utils/define-rule.js";
import type { Rule } from "../../utils/rule.js";

export const rnPreferContentInsetAdjustment = defineRule<Rule>({
  id: "rn-prefer-content-inset-adjustment",
  title: "Manual safe-area inset adjustment",
  tags: ["test-noise"],
  requires: ["react-native"],
  defaultEnabled: false,
  severity: "warn",
  recommendation:
    "Prefer native content inset adjustment only when it replaces manual inset plumbing; SafeAreaView wrappers are valid and intentionally ignored.",
  create: () => ({}),
});
