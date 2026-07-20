import { createRemotionCssTimeRuleVisitors } from "../../utils/create-remotion-css-time-rule-visitors.js";
import { defineRule } from "../../utils/define-rule.js";

const TRANSITION_STYLE_PROPERTY_NAMES = new Set(["transition", "transitionProperty"]);

export const remotionNoCssTransition = defineRule({
  id: "remotion-no-css-transition",
  title: "CSS transition is not frame-driven",
  tags: ["react-jsx-only"],
  requires: ["remotion:4"],
  severity: "error",
  recommendation:
    "Drive the property from `useCurrentFrame()` with `interpolate()` so every rendered frame is deterministic.",
  create: (context) =>
    createRemotionCssTimeRuleVisitors(context, {
      classTokenIsForbidden: (classToken) =>
        (classToken === "transition" || classToken.startsWith("transition-")) &&
        classToken !== "transition-none",
      classMessage:
        "Tailwind transitions advance on browser time, so Remotion can capture inconsistent frames. Drive the property from `useCurrentFrame()` instead.",
      styleMessage:
        "CSS transitions advance on browser time, so Remotion can capture inconsistent frames. Drive the property from `useCurrentFrame()` instead.",
      stylePropertyNames: TRANSITION_STYLE_PROPERTY_NAMES,
    }),
});
