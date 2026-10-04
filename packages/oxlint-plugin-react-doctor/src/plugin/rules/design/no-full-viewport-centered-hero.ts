import { defineRetiredRule } from "../../utils/define-retired-rule.js";

export const noFullViewportCenteredHero = defineRetiredRule({
  id: "no-full-viewport-centered-hero",
  severity: "warn",
  category: "Maintainability",
  tags: ["design", "test-noise"],
  title: "Hero uses a full-viewport centered template",
  recommendation:
    "Retired: Visual and writing preferences belong in an explicit design guide, not a general defect check.",
});
