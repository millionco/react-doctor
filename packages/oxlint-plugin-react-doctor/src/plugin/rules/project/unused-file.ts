import { defineRule } from "../../utils/define-rule.js";

export const unusedFile = defineRule({
  id: "unused-file",
  title: "Source file is unreachable",
  severity: "warn",
  execution: "project",
  defaultEnabled: false,
  recommendation:
    "Delete the file after confirming that no application, package, framework, or dynamic entry point reaches it.",
});
