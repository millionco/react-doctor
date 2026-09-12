import { defineRetiredRule } from "../../utils/define-retired-rule.js";

export const renderingAnimateSvgWrapper = defineRetiredRule({
  id: "rendering-animate-svg-wrapper",
  severity: "warn",
  category: "Performance",
  requires: ["react"],
  tags: ["test-noise"],
  title: "Animating an SVG directly",
  recommendation:
    "Retired: An SVG animate prop does not prove slow animation, and a wrapper cannot replace SVG attribute animation.",
});
