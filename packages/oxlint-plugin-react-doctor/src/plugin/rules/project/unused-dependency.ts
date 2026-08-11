import { defineRule } from "../../utils/define-rule.js";

export const unusedDependency = defineRule({
  id: "unused-dependency",
  title: "Dependency has no discovered use",
  severity: "warn",
  execution: "project",
  defaultEnabled: false,
  recommendation:
    "Remove the dependency after checking source, scripts, configuration, generated code, and dynamic loading paths.",
});
