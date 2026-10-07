import { defineRetiredRule } from "../../utils/define-retired-rule.js";

export const noIconTileHeadingStack = defineRetiredRule({
  id: "no-icon-tile-heading-stack",
  severity: "warn",
  category: "Maintainability",
  tags: ["design", "test-noise"],
  title: "Card stacks an icon tile above its heading",
  recommendation:
    "Retired: Visual and writing preferences belong in an explicit design guide, not a general defect check.",
});
