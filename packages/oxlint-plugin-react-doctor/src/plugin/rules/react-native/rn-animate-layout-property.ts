import { defineRetiredRule } from "../../utils/define-retired-rule.js";

export const rnAnimateLayoutProperty = defineRetiredRule({
  id: "rn-animate-layout-property",
  title: "Animating a layout property",
  tags: ["test-noise"],
  requires: ["react-native"],
  severity: "warn",
  recommendation:
    "Reanimated useAnimatedStyle runs on the UI thread; layout-affecting properties driven by animation helpers, interpolate, or shared values are valid.",
});
