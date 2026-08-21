import { defineRule } from "../../utils/define-rule.js";
import { createNoMultiCompVisitors } from "./no-multi-comp.js";

const MESSAGE =
  "This file declares several components, so each component is harder to find, test, and change.";

export const noMultiComponentFile = defineRule({
  id: "no-multi-component-file",
  title: "Crowded component file",
  severity: "warn",
  recommendation:
    "Move secondary components into their own files so each component stays easier to find, test, and change.",
  category: "Architecture",
  create: (context) =>
    createNoMultiCompVisitors(context, {
      message: MESSAGE,
      shouldAllowRelatedComponentColocation: true,
      shouldSkipTestlikeFiles: true,
    }),
});
