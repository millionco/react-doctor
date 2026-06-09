import { FUNCTION_LIKE_TYPES } from "../../constants/js.js";
import {
  REACT_NATIVE_LIST_COMPONENTS,
  RENDER_ITEM_PROP_NAMES,
} from "../../constants/react-native.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { hasJsxKeyAttribute } from "../../utils/has-jsx-key-attribute.js";
import { isAstNode } from "../../utils/is-ast-node.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { resolveJsxElementName } from "./utils/resolve-jsx-element-name.js";

const collectTopLevelReturnExpressions = (
  functionNode:
    | EsTreeNodeOfType<"ArrowFunctionExpression">
    | EsTreeNodeOfType<"FunctionExpression">,
): EsTreeNode[] => {
  if (isNodeOfType(functionNode, "ArrowFunctionExpression") && functionNode.body) {
    if (!isNodeOfType(functionNode.body, "BlockStatement")) {
      return [functionNode.body];
    }
  }

  const block = functionNode.body;
  if (!block || !isNodeOfType(block, "BlockStatement")) return [];

  const returnExpressions: EsTreeNode[] = [];
  const visit = (node: EsTreeNode): void => {
    if (FUNCTION_LIKE_TYPES.has(node.type)) return;
    if (isNodeOfType(node, "ReturnStatement") && node.argument) {
      returnExpressions.push(node.argument);
    }
    const nodeRecord = node as unknown as Record<string, unknown>;
    for (const fieldName of Object.keys(nodeRecord)) {
      if (fieldName === "parent") continue;
      const child = nodeRecord[fieldName];
      if (Array.isArray(child)) {
        for (const childItem of child) {
          if (isAstNode(childItem)) visit(childItem);
        }
      } else if (isAstNode(child)) {
        visit(child);
      }
    }
  };
  visit(block);
  return returnExpressions;
};

const collectReturnedJsxElements = (expression: EsTreeNode): EsTreeNodeOfType<"JSXElement">[] => {
  const elements: EsTreeNodeOfType<"JSXElement">[] = [];
  const visit = (current: EsTreeNode): void => {
    const unwrapped = stripParenExpression(current);
    if (isNodeOfType(unwrapped, "JSXElement")) {
      elements.push(unwrapped);
      return;
    }
    if (isNodeOfType(unwrapped, "ConditionalExpression")) {
      visit(unwrapped.consequent);
      visit(unwrapped.alternate);
      return;
    }
    if (isNodeOfType(unwrapped, "LogicalExpression")) {
      visit(unwrapped.right);
      if (unwrapped.operator === "||" || unwrapped.operator === "??") {
        visit(unwrapped.left);
      }
    }
  };
  visit(expression);
  return elements;
};

export const rnNoRenderitemKey = defineRule<Rule>({
  id: "rn-no-renderitem-key",
  title: "renderItem key is ignored by React Native lists",
  tags: ["test-noise"],
  requires: ["react-native"],
  severity: "warn",
  recommendation:
    "A `key` on the JSX from renderItem does nothing, since lists get row keys from `keyExtractor` (or `item.key`). Remove it and set `keyExtractor` on the list instead.",
  create: (context: RuleContext) => ({
    JSXAttribute(attributeNode: EsTreeNodeOfType<"JSXAttribute">) {
      if (
        !isNodeOfType(attributeNode.name, "JSXIdentifier") ||
        !RENDER_ITEM_PROP_NAMES.has(attributeNode.name.name)
      )
        return;

      const openingElement = attributeNode.parent;
      if (!openingElement || !isNodeOfType(openingElement, "JSXOpeningElement")) return;

      const listComponentName = resolveJsxElementName(openingElement);
      if (!listComponentName || !REACT_NATIVE_LIST_COMPONENTS.has(listComponentName)) return;

      if (!attributeNode.value || !isNodeOfType(attributeNode.value, "JSXExpressionContainer"))
        return;

      const renderFunction = attributeNode.value.expression;
      if (
        !isNodeOfType(renderFunction, "ArrowFunctionExpression") &&
        !isNodeOfType(renderFunction, "FunctionExpression")
      )
        return;

      const returnExpressions = collectTopLevelReturnExpressions(renderFunction);
      const renderPropName = attributeNode.name.name;

      for (const returnExpression of returnExpressions) {
        const returnedJsxElements = collectReturnedJsxElements(returnExpression);
        for (const jsxElement of returnedJsxElements) {
          if (!hasJsxKeyAttribute(jsxElement.openingElement)) continue;
          context.report({
            node: jsxElement.openingElement,
            message: `Your users get no benefit from \`key\` on the JSX from ${renderPropName}; the list ignores it.`,
          });
        }
      }
    },
  }),
});
