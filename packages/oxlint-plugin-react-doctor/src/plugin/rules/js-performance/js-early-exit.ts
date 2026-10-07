import { defineRetiredRule } from "../../utils/define-retired-rule.js";

export const jsEarlyExit = defineRetiredRule({
  id: "js-early-exit",
  severity: "warn",
  category: "Performance",
  tags: ["test-noise"],
  title: "Deeply nested if statements",
  recommendation:
    "Retired: Nested conditions do not establish a performance defect or a safe early return.",
});
