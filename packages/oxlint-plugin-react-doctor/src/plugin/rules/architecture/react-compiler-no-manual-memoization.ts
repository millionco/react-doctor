import { defineRetiredRule } from "../../utils/define-retired-rule.js";

export const reactCompilerNoManualMemoization = defineRetiredRule({
  id: "react-compiler-no-manual-memoization",
  severity: "warn",
  category: "Maintainability",
  requires: ["react-compiler"],
  title: "Manual memoization in compiler-managed code",
  recommendation:
    "Retired: Compiler availability does not prove that existing manual memoization is redundant. Check its purpose and performance before removing it.",
});
