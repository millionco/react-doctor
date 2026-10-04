import { defineRule } from "../../utils/define-rule.js";

export const circularDependency = defineRule({
  id: "circular-dependency",
  title: "Runtime import cycle",
  severity: "warn",
  execution: "project",
  defaultEnabled: false,
  recommendation:
    "Break the runtime cycle by extracting shared code into a lower-level module or inverting one dependency.",
});
