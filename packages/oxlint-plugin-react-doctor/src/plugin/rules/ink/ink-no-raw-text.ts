import { MINIMUM_INK_VERSIONS } from "../../constants/ink.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findNearestInkJsxElement } from "../../utils/find-nearest-ink-jsx-element.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";

const TEXT_COMPONENT_NAMES = new Set(["Text", "Transform"]);

const isStaticRawText = (node: EsTreeNode): boolean => {
  if (isNodeOfType(node, "JSXText")) return Boolean(node.value.trim());
  if (!isNodeOfType(node, "JSXExpressionContainer")) return false;
  const parent = node.parent;
  if (!isNodeOfType(parent, "JSXElement") && !isNodeOfType(parent, "JSXFragment")) {
    return false;
  }
  if (!parent.children.some((child) => child === node)) return false;
  if (isNodeOfType(parent, "JSXElement") && node.range[0] < parent.openingElement.range[1]) {
    return false;
  }
  const expression = node.expression;
  return (
    (isNodeOfType(expression, "Literal") &&
      (typeof expression.value === "string" || typeof expression.value === "number")) ||
    (isNodeOfType(expression, "TemplateLiteral") && expression.expressions.length === 0)
  );
};

export const inkNoRawText = defineRule({
  id: "ink-no-raw-text",
  title: "Raw text outside Ink Text",
  severity: "error",
  minimumInkVersion: MINIMUM_INK_VERSIONS.base,
  recommendation: "Wrap terminal text in Ink's `<Text>` component.",
  create: (context) => ({
    JSXText(node: EsTreeNodeOfType<"JSXText">) {
      const parentInkElementName = findNearestInkJsxElement(node, context.scopes);
      if (
        isStaticRawText(node) &&
        parentInkElementName &&
        !TEXT_COMPONENT_NAMES.has(parentInkElementName)
      ) {
        context.report({
          node,
          message: "Raw text outside `<Text>` crashes Ink; wrap it in `<Text>`.",
        });
      }
    },
    JSXExpressionContainer(node: EsTreeNodeOfType<"JSXExpressionContainer">) {
      const parentInkElementName = findNearestInkJsxElement(node, context.scopes);
      if (
        isStaticRawText(node) &&
        parentInkElementName &&
        !TEXT_COMPONENT_NAMES.has(parentInkElementName)
      ) {
        context.report({
          node,
          message: "Raw text outside `<Text>` crashes Ink; wrap it in `<Text>`.",
        });
      }
    },
  }),
});
