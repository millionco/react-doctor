import { defineRule } from "../../utils/define-rule.js";

export const unusedExport = defineRule({
  id: "unused-export",
  title: "Value export has no importer",
  severity: "warn",
  execution: "project",
  defaultEnabled: false,
  recommendation:
    "Remove the export or make it module-private after confirming that no external, generated, or dynamic consumer uses it.",
});
