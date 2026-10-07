import { defineRetiredRule } from "../../utils/define-retired-rule.js";

export const noJsxElementType = defineRetiredRule({
  id: "no-jsx-element-type",
  severity: "warn",
  category: "Bugs",
  title: "No JSX.Element",
  recommendation:
    "Retired: A component can intentionally promise an element return value. Widen its type only when its return values require it.",
});
