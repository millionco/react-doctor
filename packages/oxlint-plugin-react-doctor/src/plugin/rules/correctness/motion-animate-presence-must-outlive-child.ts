import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { functionReturnsMatchingExpression } from "../../utils/function-returns-matching-expression.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isProvenFramerMotionJsxElement } from "../../utils/is-proven-framer-motion-jsx-element.js";
import { isProvenMotionReactComponent } from "../../utils/is-proven-motion-react-component.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { walkAst } from "../../utils/walk-ast.js";

const RENDERED_COLLECTION_METHOD_NAMES: ReadonlySet<string> = new Set(["map", "flatMap"]);

const isStaticallyTrueAttribute = (attribute: EsTreeNodeOfType<"JSXAttribute"> | null): boolean => {
  if (!attribute) return false;
  if (!attribute.value) return true;
  if (!isNodeOfType(attribute.value, "JSXExpressionContainer")) return false;
  const expression = attribute.value.expression;
  return isNodeOfType(expression, "Literal") && expression.value === true;
};

const containsExitBearingMotionElement = (
  node: EsTreeNodeOfType<"JSXElement">,
  context: RuleContext,
): boolean => {
  const expressionContainsExitBearingMotionElement = (expression: EsTreeNode): boolean => {
    let didFindExit = false;
    walkAst(expression, (descendant) => {
      if (didFindExit) return false;
      if (descendant !== expression && isFunctionLike(descendant)) return false;
      if (!isNodeOfType(descendant, "JSXOpeningElement")) return;
      if (!isProvenFramerMotionJsxElement(descendant, context.scopes)) return;
      if (getAuthoritativeJsxAttribute(descendant.attributes, "exit")) didFindExit = true;
    });
    return didFindExit;
  };
  const isRenderedCollectionCallback = (descendant: EsTreeNode): boolean => {
    const callExpression = descendant.parent;
    return Boolean(
      callExpression &&
      isNodeOfType(callExpression, "CallExpression") &&
      callExpression.arguments[0] === descendant &&
      isNodeOfType(callExpression.callee, "MemberExpression") &&
      RENDERED_COLLECTION_METHOD_NAMES.has(getStaticPropertyName(callExpression.callee) ?? ""),
    );
  };
  let didFindExit = false;
  walkAst(node, (descendant) => {
    if (descendant !== node && isFunctionLike(descendant)) {
      if (
        isRenderedCollectionCallback(descendant) &&
        functionReturnsMatchingExpression(
          descendant,
          context.scopes,
          expressionContainsExitBearingMotionElement,
          context.cfg,
        )
      ) {
        didFindExit = true;
      }
      return false;
    }
    if (didFindExit || !isNodeOfType(descendant, "JSXOpeningElement")) return;
    if (!isProvenFramerMotionJsxElement(descendant, context.scopes)) return;
    if (getAuthoritativeJsxAttribute(descendant.attributes, "exit")) didFindExit = true;
  });
  return didFindExit;
};

const getMountCondition = (node: EsTreeNodeOfType<"JSXElement">): EsTreeNode | null => {
  let current: EsTreeNode | null | undefined = node.parent;
  while (current) {
    if (isNodeOfType(current, "LogicalExpression")) return current;
    if (isNodeOfType(current, "ConditionalExpression")) return current;
    if (
      isNodeOfType(current, "ArrowFunctionExpression") ||
      isNodeOfType(current, "FunctionExpression") ||
      isNodeOfType(current, "FunctionDeclaration")
    ) {
      return null;
    }
    current = current.parent;
  }
  return null;
};

const isOwnedByAncestorAnimatePresence = (condition: EsTreeNode, context: RuleContext): boolean => {
  const expressionContainer = condition.parent;
  const parentElement = expressionContainer?.parent;
  return Boolean(
    expressionContainer &&
    isNodeOfType(expressionContainer, "JSXExpressionContainer") &&
    parentElement &&
    isNodeOfType(parentElement, "JSXElement") &&
    isProvenMotionReactComponent(
      parentElement.openingElement.name,
      "AnimatePresence",
      context.scopes,
    ),
  );
};

const hasAncestorAnimatePresence = (
  node: EsTreeNodeOfType<"JSXElement">,
  context: RuleContext,
): boolean => {
  let current: EsTreeNode | null | undefined = node.parent;
  while (current) {
    if (
      isNodeOfType(current, "JSXElement") &&
      isProvenMotionReactComponent(current.openingElement.name, "AnimatePresence", context.scopes)
    ) {
      return true;
    }
    current = current.parent;
  }
  return false;
};

export const motionAnimatePresenceMustOutliveChild = defineRule({
  id: "motion-animate-presence-must-outlive-child",
  title: "AnimatePresence unmounts with its exiting child",
  severity: "warn",
  category: "Correctness",
  recommendation:
    "Keep AnimatePresence mounted and place the condition around its child so Motion can observe and animate the child leaving.",
  create: (context: RuleContext) => ({
    JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
      if (
        !isProvenMotionReactComponent(node.openingElement.name, "AnimatePresence", context.scopes)
      ) {
        return;
      }
      const propagateAttribute = getAuthoritativeJsxAttribute(
        node.openingElement.attributes,
        "propagate",
      );
      if (
        isStaticallyTrueAttribute(propagateAttribute) &&
        hasAncestorAnimatePresence(node, context)
      ) {
        return;
      }
      if (!containsExitBearingMotionElement(node, context)) return;
      const mountCondition = getMountCondition(node);
      if (!mountCondition) return;
      if (isOwnedByAncestorAnimatePresence(mountCondition, context)) return;
      context.report({
        node: node.openingElement,
        message:
          "This AnimatePresence boundary is removed by the same condition as its child, so it cannot observe the child leaving or run its exit animation. Keep the boundary mounted and conditionally render the child inside it.",
      });
    },
  }),
});
