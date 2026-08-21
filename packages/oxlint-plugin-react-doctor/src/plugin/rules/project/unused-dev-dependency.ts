import { defineRule } from "../../utils/define-rule.js";

export const unusedDevDependency = defineRule({
  id: "unused-dev-dependency",
  title: "Development dependency has no discovered use",
  severity: "warn",
  execution: "project",
  defaultEnabled: false,
  recommendation:
    "Remove the development dependency after checking scripts, configuration, CI, generators, and indirect tool loading.",
});
