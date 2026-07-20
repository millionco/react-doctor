import { createRemotionCssTimeRuleVisitors } from "../../utils/create-remotion-css-time-rule-visitors.js";
import { defineRule } from "../../utils/define-rule.js";

const ANIMATION_STYLE_PROPERTY_NAMES = new Set(["animation", "animationName"]);

export const remotionNoCssAnimation = defineRule({
  id: "remotion-no-css-animation",
  title: "CSS animation is not frame-driven",
  tags: ["react-jsx-only"],
  requires: ["remotion:4"],
  severity: "error",
  recommendation:
    "Drive the property from `useCurrentFrame()` with `interpolate()` so every rendered frame is deterministic.",
  create: (context) =>
    createRemotionCssTimeRuleVisitors(context, {
      classTokenIsForbidden: (classToken) =>
        classToken.startsWith("animate-") && classToken !== "animate-none",
      classMessage:
        "Tailwind animations advance on browser time, so Remotion can capture inconsistent frames. Drive the property from `useCurrentFrame()` instead.",
      styleMessage:
        "CSS animations advance on browser time, so Remotion can capture inconsistent frames. Drive the property from `useCurrentFrame()` instead.",
      stylePropertyNames: ANIMATION_STYLE_PROPERTY_NAMES,
    }),
});
