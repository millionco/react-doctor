import { VAGUE_BUTTON_LABELS } from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { getStaticTemplateLiteralValue } from "../../utils/get-static-template-literal-value.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getOpeningElementTagName } from "./utils/get-opening-element-tag-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const isButtonLikeTagName = (tagName: string): boolean => {
  return tagName === "button" || tagName === "Button";
};

const isPreviousStepControlTagName = (tagName: string): boolean =>
  isButtonLikeTagName(tagName) || tagName === "a" || tagName === "Link";

const PREVIOUS_STEP_LABELS = new Set(["back", "previous"]);

const getNormalizedLabel = (labelText: string): string =>
  labelText
    .toLowerCase()
    .replace(/[.!?…]+$/, "")
    .trim();

const collectJsxLabelText = (jsxElementNode: EsTreeNode): string | null => {
  if (!isNodeOfType(jsxElementNode, "JSXElement") && !isNodeOfType(jsxElementNode, "JSXFragment"))
    return null;
  const childList = jsxElementNode.children ?? [];
  if (childList.length === 0) return null;
  const collectedFragments: string[] = [];
  for (const childNode of childList) {
    if (isNodeOfType(childNode, "JSXText")) {
      collectedFragments.push(typeof childNode.value === "string" ? childNode.value : "");
      continue;
    }
    if (isNodeOfType(childNode, "JSXExpressionContainer")) {
      const expression = childNode.expression;
      if (isNodeOfType(expression, "Literal") && typeof expression.value === "string") {
        collectedFragments.push(expression.value);
        continue;
      }
      if (isNodeOfType(expression, "TemplateLiteral")) {
        const staticValue = getStaticTemplateLiteralValue(expression);
        if (staticValue !== null) {
          collectedFragments.push(staticValue);
          continue;
        }
      }
      return null;
    }
    if (isNodeOfType(childNode, "JSXFragment")) {
      const fragmentLabel = collectJsxLabelText(childNode);
      if (fragmentLabel === null) return null;
      collectedFragments.push(fragmentLabel);
      continue;
    }
    if (isNodeOfType(childNode, "JSXElement")) {
      return null;
    }
  }
  return collectedFragments.join("").trim();
};

const findEnclosingForm = (node: EsTreeNode): EsTreeNodeOfType<"JSXElement"> | null => {
  let currentNode = node.parent;
  while (currentNode) {
    if (
      isNodeOfType(currentNode, "JSXElement") &&
      getOpeningElementTagName(currentNode.openingElement) === "form"
    ) {
      return currentNode;
    }
    currentNode = currentNode.parent;
  }
  return null;
};

const hasPreviousStepControl = (
  node: EsTreeNodeOfType<"JSXElement"> | EsTreeNodeOfType<"JSXFragment">,
): boolean => {
  for (const childNode of node.children ?? []) {
    if (isNodeOfType(childNode, "JSXFragment")) {
      if (hasPreviousStepControl(childNode)) return true;
      continue;
    }
    if (!isNodeOfType(childNode, "JSXElement")) continue;
    const tagName = getOpeningElementTagName(childNode.openingElement);
    if (
      tagName &&
      isPreviousStepControlTagName(tagName) &&
      PREVIOUS_STEP_LABELS.has(getNormalizedLabel(collectJsxLabelText(childNode) ?? ""))
    ) {
      return true;
    }
    if (hasPreviousStepControl(childNode)) return true;
  }
  return false;
};

export const noVagueButtonLabel = defineRule({
  id: "design-no-vague-button-label",
  title: "Vague button label",
  tags: ["design", "test-noise"],
  severity: "warn",
  defaultEnabled: false,
  recommendation:
    'Name the action: "Save changes" instead of "Continue", "Send invite" instead of "Submit". The label is the button\'s accessible name.',
  create: (context: RuleContext) => ({
    JSXElement(jsxElementNode: EsTreeNodeOfType<"JSXElement">) {
      const tagName = getOpeningElementTagName(jsxElementNode.openingElement);
      if (!tagName || !isButtonLikeTagName(tagName)) return;
      const labelText = collectJsxLabelText(jsxElementNode);
      if (!labelText) return;
      const normalizedLabel = getNormalizedLabel(labelText);
      if (!VAGUE_BUTTON_LABELS.has(normalizedLabel)) return;
      if (normalizedLabel === "continue") {
        const enclosingForm = findEnclosingForm(jsxElementNode);
        if (enclosingForm && hasPreviousStepControl(enclosingForm)) return;
      }
      context.report({
        node: jsxElementNode.openingElement ?? jsxElementNode,
        message: `Screen reader users may not know what "${labelText}" does. Use a specific action label.`,
      });
    },
  }),
});
