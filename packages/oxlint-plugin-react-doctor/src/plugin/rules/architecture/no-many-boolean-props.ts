import { defineRetiredRule } from "../../utils/define-retired-rule.js";

export const noManyBooleanProps = defineRetiredRule({
  id: "no-many-boolean-props",
  severity: "warn",
  category: "Maintainability",
  tags: ["test-noise", "react-jsx-only"],
  title: "Boolean prop combinations are hard to test",
  recommendation:
    "Retired: Boolean prop count does not establish invalid state combinations or a defective API.",
});
