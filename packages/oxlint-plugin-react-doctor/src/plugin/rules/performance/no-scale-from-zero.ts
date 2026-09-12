import { defineRetiredRule } from "../../utils/define-retired-rule.js";

export const noScaleFromZero = defineRetiredRule({
  id: "no-scale-from-zero",
  severity: "warn",
  category: "Performance",
  requires: ["react"],
  tags: ["test-noise"],
  title: "Animating scale from zero",
  recommendation:
    "Retired: A zero scale endpoint is an animation design choice, not a proven defect.",
});
