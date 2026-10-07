import { defineRetiredRule } from "../../utils/define-retired-rule.js";

export const noHeroEyebrowChip = defineRetiredRule({
  id: "no-hero-eyebrow-chip",
  severity: "warn",
  category: "Maintainability",
  tags: ["design", "test-noise"],
  title: "Hero uses a decorative eyebrow label",
  recommendation:
    "Retired: Visual and writing preferences belong in an explicit design guide, not a general defect check.",
});
