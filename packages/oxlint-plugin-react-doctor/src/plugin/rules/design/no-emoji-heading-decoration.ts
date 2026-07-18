import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getReactDoctorStringSetting } from "../../utils/get-react-doctor-setting.js";
import { getStaticTemplateLiteralValue } from "../../utils/get-static-template-literal-value.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";

const HEADING_ELEMENT_PATTERN = /^h[1-6]$/;
const LEADING_EMOJI_PATTERN = /^\s*\p{Extended_Pictographic}/u;
const EXCLUDED_CONTENT_PATH_PATTERN =
  /(?:^|[/\\])(?:docs?|documentation|demos?|examples?|sandbox(?:es)?|playgrounds?|stories?|tests?|__tests__)(?:[/\\]|$)/i;

const isExcludedContentPath = (context: RuleContext): boolean => {
  const rootDirectory = getReactDoctorStringSetting(context.settings, "rootDirectory") ?? "";
  return EXCLUDED_CONTENT_PATH_PATTERN.test(`${rootDirectory}/${context.filename ?? ""}`);
};

const isIntrinsicElement = (node: EsTreeNodeOfType<"JSXElement">): boolean =>
  isNodeOfType(node.openingElement.name, "JSXIdentifier") &&
  node.openingElement.name.name === node.openingElement.name.name.toLowerCase();

const hasLeadingStaticEmojiContent = (node: EsTreeNode | null | undefined): boolean => {
  if (!node) return false;
  const unwrappedNode = stripParenExpression(node);
  if (isNodeOfType(unwrappedNode, "JSXText")) {
    return LEADING_EMOJI_PATTERN.test(unwrappedNode.value ?? "");
  }
  if (isNodeOfType(unwrappedNode, "Literal")) {
    return (
      typeof unwrappedNode.value === "string" && LEADING_EMOJI_PATTERN.test(unwrappedNode.value)
    );
  }
  if (isNodeOfType(unwrappedNode, "TemplateLiteral")) {
    const staticValue = getStaticTemplateLiteralValue(unwrappedNode);
    return staticValue !== null && LEADING_EMOJI_PATTERN.test(staticValue);
  }
  if (isNodeOfType(unwrappedNode, "ConditionalExpression")) {
    return (
      hasLeadingStaticEmojiContent(unwrappedNode.consequent) ||
      hasLeadingStaticEmojiContent(unwrappedNode.alternate)
    );
  }
  if (isNodeOfType(unwrappedNode, "JSXExpressionContainer")) {
    return hasLeadingStaticEmojiContent(unwrappedNode.expression);
  }
  if (
    isNodeOfType(unwrappedNode, "JSXFragment") ||
    (isNodeOfType(unwrappedNode, "JSXElement") && isIntrinsicElement(unwrappedNode))
  ) {
    const firstContentChild = (unwrappedNode.children ?? []).find(
      (childNode) => !isNodeOfType(childNode, "JSXText") || Boolean(childNode.value?.trim()),
    );
    return hasLeadingStaticEmojiContent(firstContentChild);
  }
  return false;
};

export const noEmojiHeadingDecoration = defineRule({
  id: "no-emoji-heading-decoration",
  title: "Heading uses emoji as decoration",
  severity: "warn",
  defaultEnabled: false,
  tags: ["design", "test-noise", "react-jsx-only"],
  recommendation:
    "Use purposeful product artwork or a consistent icon system outside the heading instead of decorating heading copy with platform-dependent emoji.",
  create: (context: RuleContext) => ({
    JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
      if (isExcludedContentPath(context)) return;
      if (
        !isNodeOfType(node.openingElement.name, "JSXIdentifier") ||
        !HEADING_ELEMENT_PATTERN.test(node.openingElement.name.name) ||
        !hasLeadingStaticEmojiContent(node)
      ) {
        return;
      }
      context.report({
        node: node.openingElement,
        message:
          "This heading uses emoji as decoration. Keep the heading typographic and move visual identity into a consistent icon or illustration system.",
      });
    },
  }),
});
