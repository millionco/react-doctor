import { defineRule } from "../../utils/define-rule.js";
import { createNoMultiCompVisitors } from "./no-multi-comp.js";

const MESSAGE =
  "This file declares several unrelated components, so each component is harder to find, test, and change.";

export const noCrowdedComponentFile = defineRule({
  id: "no-crowded-component-file",
  title: "Crowded component file",
  severity: "warn",
  recommendation:
    "Move unrelated secondary components into their own files while keeping cohesive feature modules and component part sets together.",
  category: "Architecture",
  create: (context) =>
    createNoMultiCompVisitors(context, {
      message: MESSAGE,
      shouldAllowRelatedComponentColocation: true,
      shouldSkipTestlikeFiles: true,
    }),
});
