import { defineRule } from "../../utils/define-rule.js";

export const unusedType = defineRule({
  id: "unused-type",
  title: "Type export has no importer",
  severity: "warn",
  execution: "project",
  defaultEnabled: false,
  recommendation:
    "Remove the export or declaration after confirming that it is not part of a package's public type surface.",
});
