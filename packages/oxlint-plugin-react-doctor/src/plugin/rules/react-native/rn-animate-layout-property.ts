import { defineRetiredRule } from "../../utils/define-retired-rule.js";

export const rnAnimateLayoutProperty = defineRetiredRule({
  id: "rn-animate-layout-property",
  title: "Animating a layout property",
  tags: ["test-noise"],
  requires: ["react-native"],
  severity: "warn",
  recommendation:
    "Retired: Reanimated `useAnimatedStyle` can safely drive layout-affecting properties on the UI thread, so this pattern should not be flagged.",
});
