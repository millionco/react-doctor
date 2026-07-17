import { defineRule } from "../../utils/define-rule.js";
import { getUnvariantClassNameTokens } from "../../utils/get-unvariant-class-name-tokens.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";

const ROOT_LAYOUT_CLASS_NAMES = new Set(["h-dvh", "h-screen", "min-h-dvh", "min-h-screen"]);
const GRADIENT_UTILITY_PATTERN = /^bg-(?:gradient|linear)-to-/;
const PURPLE_STOP_PATTERN = /^(?:from|via|to)-(?:indigo|purple|violet)-/;
const BRIGHT_STOP_PATTERN = /^(?:from|via|to)-(?:blue|cyan|fuchsia|pink)-/;

export const noDefaultPurplePageGradient = defineRule({
  id: "no-default-purple-page-gradient",
  title: "Page root uses a default purple-spectrum gradient",
  severity: "warn",
  defaultEnabled: false,
  tags: ["design", "test-noise"],
  recommendation:
    "Build the page palette from the product's identity instead of a conventional purple-to-bright gradient.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      const classNameValue = getStringFromClassNameAttr(node);
      if (!classNameValue) return;
      const tokens = getUnvariantClassNameTokens(classNameValue);
      const isPageRoot =
        (isNodeOfType(node.name, "JSXIdentifier") && node.name.name === "main") ||
        tokens.some((token) => ROOT_LAYOUT_CLASS_NAMES.has(token));
      if (!isPageRoot || !tokens.some((token) => GRADIENT_UTILITY_PATTERN.test(token))) return;
      const hasPurpleStop = tokens.some((token) => PURPLE_STOP_PATTERN.test(token));
      const hasBrightStop = tokens.some((token) => BRIGHT_STOP_PATTERN.test(token));
      if (!hasPurpleStop || !hasBrightStop) return;
      context.report({
        node,
        message:
          "This page-wide purple-spectrum gradient is a common default treatment. Choose a palette relationship specific to the product.",
      });
    },
  }),
});
