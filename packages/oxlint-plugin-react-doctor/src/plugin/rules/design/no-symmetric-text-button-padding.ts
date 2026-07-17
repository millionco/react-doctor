import { defineRule } from "../../utils/define-rule.js";
import { getStaticJsxText } from "../../utils/get-static-jsx-text.js";
import { getUnvariantClassNameTokens } from "../../utils/get-unvariant-class-name-tokens.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";

const SYMMETRIC_PADDING_PATTERN = /^p-(?:px|[\d.]+|\[[^\]]+\])$/;
const AXIS_PADDING_PATTERN = /^p[xytrbles]-(?:px|[\d.]+|\[[^\]]+\])$/;

export const noSymmetricTextButtonPadding = defineRule({
  id: "no-symmetric-text-button-padding",
  title: "Text button uses symmetric padding",
  severity: "warn",
  defaultEnabled: false,
  tags: ["design", "test-noise"],
  recommendation:
    "Give text buttons more horizontal than vertical padding to preserve their control shape.",
  create: (context: RuleContext) => ({
    JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
      if (
        !isNodeOfType(node.openingElement.name, "JSXIdentifier") ||
        node.openingElement.name.name !== "button" ||
        node.children.some((child) => isNodeOfType(child, "JSXExpressionContainer")) ||
        !getStaticJsxText(node).trim()
      ) {
        return;
      }
      const classNameValue = getStringFromClassNameAttr(node.openingElement);
      if (!classNameValue) return;
      const tokens = getUnvariantClassNameTokens(classNameValue);
      if (
        !tokens.some((token) => SYMMETRIC_PADDING_PATTERN.test(token)) ||
        tokens.some((token) => AXIS_PADDING_PATTERN.test(token))
      ) {
        return;
      }
      context.report({
        node: node.openingElement,
        message:
          "This text button applies equal padding on every side, which makes the control feel boxy. Use separate horizontal and vertical padding with more space on the inline axis.",
      });
    },
  }),
});
