import { defineRetiredRule } from "../../utils/define-retired-rule.js";
import type { Rule } from "../../utils/rule.js";

export const rnAnimateLayoutProperty = defineRetiredRule({
  id: "rn-animate-layout-property",
  title: "Animating a layout property",
  tags: ["test-noise"],
  requires: ["react-native"],
  severity: "warn",
  category: "Performance",
  recommendation:
    "This retired rule no longer reports Reanimated layout styles. Reanimated supports animating layout-affecting styles; prefer transform or opacity for purely visual motion when that preserves the intended layout.",
} satisfies Omit<Rule, "create" | "defaultEnabled" | "lifecycle">);
