import { areExpressionsStructurallyEqual } from "../../utils/are-expressions-structurally-equal.js";
import { defineRule } from "../../utils/define-rule.js";
import { executesDuringRender } from "../../utils/executes-during-render.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { findEnclosingJsxOpeningElement } from "../../utils/find-enclosing-jsx-opening-element.js";
import { findRenderPhaseComponentOrHook } from "../../utils/find-render-phase-component-or-hook.js";
import { flattenJsxName } from "../../utils/flatten-jsx-name.js";
import { hasClientRenderEvidence } from "../../utils/has-client-render-evidence.js";
import { hasDirective } from "../../utils/has-directive.js";
import { hasEmailTemplateImport } from "../../utils/has-email-template-import.js";
import { hasSuppressHydrationWarningAttribute } from "../../utils/has-suppress-hydration-warning-attribute.js";
import { isAstNode } from "../../utils/is-ast-node.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isGeneratedImageRenderContext } from "../../utils/is-generated-image-render-context.js";
import { isInsideClientOnlyGuard } from "../../utils/is-inside-client-only-guard.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { classifyReactNativeFileTarget } from "../../utils/is-react-native-file.js";
import { isTestlikeFilename } from "../../utils/is-testlike-filename.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { RuleVisitors } from "../../utils/rule-visitors.js";

interface BrowserPredicateMatch {
  readonly browserGlobalName: "window" | "document";
  readonly clientResult: boolean;
  readonly serverResult: boolean;
}

const evaluateEquality = (operator: string, left: string, right: string): boolean | null => {
  if (operator === "===" || operator === "==") return left === right;
  if (operator === "!==" || operator === "!=") return left !== right;
  return null;
};

const readTypeofBrowserGlobal = (
  expression: EsTreeNode,
  context: RuleContext,
): "window" | "document" | null => {
  const unwrappedExpression = stripParenExpression(expression);
  if (
    !isNodeOfType(unwrappedExpression, "UnaryExpression") ||
    unwrappedExpression.operator !== "typeof"
  ) {
    return null;
  }
  const argument = stripParenExpression(unwrappedExpression.argument);
  if (
    !isNodeOfType(argument, "Identifier") ||
    (argument.name !== "window" && argument.name !== "document") ||
    !context.scopes.isGlobalReference(argument)
  ) {
    return null;
  }
  return argument.name;
};

const matchBrowserPredicate = (
  expression: EsTreeNode,
  context: RuleContext,
): BrowserPredicateMatch | null => {
  const unwrappedExpression = stripParenExpression(expression);
  if (
    isNodeOfType(unwrappedExpression, "UnaryExpression") &&
    unwrappedExpression.operator === "!"
  ) {
    const innerMatch = matchBrowserPredicate(unwrappedExpression.argument, context);
    return innerMatch
      ? {
          browserGlobalName: innerMatch.browserGlobalName,
          clientResult: !innerMatch.clientResult,
          serverResult: !innerMatch.serverResult,
        }
      : null;
  }
  if (!isNodeOfType(unwrappedExpression, "BinaryExpression")) return null;
  const leftGlobalName = readTypeofBrowserGlobal(unwrappedExpression.left, context);
  const rightGlobalName = readTypeofBrowserGlobal(unwrappedExpression.right, context);
  const leftString = isNodeOfType(unwrappedExpression.left, "Literal")
    ? unwrappedExpression.left.value
    : null;
  const rightString = isNodeOfType(unwrappedExpression.right, "Literal")
    ? unwrappedExpression.right.value
    : null;
  const browserGlobalName =
    leftGlobalName && typeof rightString === "string"
      ? leftGlobalName
      : rightGlobalName && typeof leftString === "string"
        ? rightGlobalName
        : null;
  const comparedType =
    leftGlobalName && typeof rightString === "string"
      ? rightString
      : rightGlobalName && typeof leftString === "string"
        ? leftString
        : null;
  if (!browserGlobalName || !comparedType) return null;
  const clientResult = evaluateEquality(unwrappedExpression.operator, "object", comparedType);
  const serverResult = evaluateEquality(unwrappedExpression.operator, "undefined", comparedType);
  if (clientResult === null || serverResult === null || clientResult === serverResult) return null;
  return { browserGlobalName, clientResult, serverResult };
};

const areNodeArraysEquivalent = (
  leftNodes: ReadonlyArray<EsTreeNode>,
  rightNodes: ReadonlyArray<EsTreeNode>,
): boolean =>
  leftNodes.length === rightNodes.length &&
  leftNodes.every((leftNode, index) => areRenderedBranchesEquivalent(leftNode, rightNodes[index]));

const areRenderedBranchesEquivalent = (
  leftNode: EsTreeNode | null | undefined,
  rightNode: EsTreeNode | null | undefined,
): boolean => {
  if (!leftNode || !rightNode) return leftNode === rightNode;
  const left = stripParenExpression(leftNode);
  const right = stripParenExpression(rightNode);
  if (areExpressionsStructurallyEqual(left, right)) return true;
  if (left.type !== right.type) return false;
  if (isNodeOfType(left, "JSXText") && isNodeOfType(right, "JSXText")) {
    return left.value === right.value;
  }
  if (
    isNodeOfType(left, "JSXExpressionContainer") &&
    isNodeOfType(right, "JSXExpressionContainer")
  ) {
    if (!isAstNode(left.expression) || !isAstNode(right.expression)) {
      return left.expression.type === right.expression.type;
    }
    return areRenderedBranchesEquivalent(left.expression, right.expression);
  }
  if (isNodeOfType(left, "JSXElement") && isNodeOfType(right, "JSXElement")) {
    if (flattenJsxName(left.openingElement.name) !== flattenJsxName(right.openingElement.name)) {
      return false;
    }
    if (!areNodeArraysEquivalent(left.openingElement.attributes, right.openingElement.attributes)) {
      return false;
    }
    return areNodeArraysEquivalent(left.children, right.children);
  }
  if (isNodeOfType(left, "JSXFragment") && isNodeOfType(right, "JSXFragment")) {
    return areNodeArraysEquivalent(left.children, right.children);
  }
  if (isNodeOfType(left, "JSXAttribute") && isNodeOfType(right, "JSXAttribute")) {
    if (flattenJsxName(left.name) !== flattenJsxName(right.name)) return false;
    return areRenderedBranchesEquivalent(left.value, right.value);
  }
  if (isNodeOfType(left, "JSXSpreadAttribute") && isNodeOfType(right, "JSXSpreadAttribute")) {
    return areRenderedBranchesEquivalent(left.argument, right.argument);
  }
  if (isNodeOfType(left, "TemplateLiteral") && isNodeOfType(right, "TemplateLiteral")) {
    if (left.quasis.length !== right.quasis.length) return false;
    if (
      !left.quasis.every(
        (quasi, index) =>
          quasi.value.cooked === right.quasis[index]?.value.cooked &&
          quasi.value.raw === right.quasis[index]?.value.raw,
      )
    ) {
      return false;
    }
    return areNodeArraysEquivalent(left.expressions, right.expressions);
  }
  return false;
};

const isRenderedValue = (node: EsTreeNode): boolean => {
  const unwrappedNode = stripParenExpression(node);
  return (
    isNodeOfType(unwrappedNode, "JSXElement") ||
    isNodeOfType(unwrappedNode, "JSXFragment") ||
    isNodeOfType(unwrappedNode, "Literal") ||
    isNodeOfType(unwrappedNode, "TemplateLiteral")
  );
};

const findEnclosingJsxAttribute = (node: EsTreeNode): EsTreeNodeOfType<"JSXAttribute"> | null => {
  let currentNode = node.parent;
  while (currentNode) {
    if (isNodeOfType(currentNode, "JSXAttribute")) return currentNode;
    if (
      isNodeOfType(currentNode, "JSXElement") ||
      isNodeOfType(currentNode, "JSXFragment") ||
      isFunctionLike(currentNode)
    ) {
      return null;
    }
    currentNode = currentNode.parent;
  }
  return null;
};

const isEventHandlerAttribute = (attribute: EsTreeNodeOfType<"JSXAttribute">): boolean =>
  isNodeOfType(attribute.name, "JSXIdentifier") && /^on[A-Z]/.test(attribute.name.name);

const isInRenderedOutput = (node: EsTreeNode, componentOrHookNode: EsTreeNode): boolean => {
  let currentNode = node;
  let parentNode = currentNode.parent;
  while (parentNode) {
    if (isNodeOfType(parentNode, "JSXExpressionContainer")) {
      const attribute = findEnclosingJsxAttribute(parentNode);
      return attribute ? !isEventHandlerAttribute(attribute) : true;
    }
    if (isNodeOfType(parentNode, "ReturnStatement")) {
      const returnFunction = findEnclosingFunction(parentNode);
      if (returnFunction === componentOrHookNode) return true;
    }
    if (parentNode === componentOrHookNode) {
      return (
        isFunctionLike(componentOrHookNode) &&
        !isNodeOfType(componentOrHookNode.body, "BlockStatement") &&
        componentOrHookNode.body === currentNode
      );
    }
    if (isFunctionLike(parentNode) && !executesDuringRender(parentNode)) return false;
    currentNode = parentNode;
    parentNode = currentNode.parent;
  }
  return false;
};

const getReturnedValue = (statement: EsTreeNode | null | undefined): EsTreeNode | null => {
  if (!statement) return null;
  if (isNodeOfType(statement, "ReturnStatement")) return statement.argument ?? null;
  if (!isNodeOfType(statement, "BlockStatement")) return null;
  const lastStatement = statement.body.at(-1);
  return isNodeOfType(lastStatement, "ReturnStatement") ? (lastStatement.argument ?? null) : null;
};

const findFollowingReturnValue = (
  ifStatement: EsTreeNodeOfType<"IfStatement">,
): EsTreeNode | null => {
  const parentNode = ifStatement.parent;
  if (!isNodeOfType(parentNode, "BlockStatement")) return null;
  const statementIndex = parentNode.body.findIndex((statement) => statement === ifStatement);
  if (statementIndex < 0) return null;
  return getReturnedValue(parentNode.body[statementIndex + 1]);
};

const branchHasSuppression = (branch: EsTreeNode): boolean => {
  const unwrappedBranch = stripParenExpression(branch);
  return (
    isNodeOfType(unwrappedBranch, "JSXElement") &&
    hasSuppressHydrationWarningAttribute(unwrappedBranch.openingElement)
  );
};

export const noHydrationBranchOnBrowserGlobal = defineRule({
  id: "no-hydration-branch-on-browser-global",
  title: "Server and client render different branches",
  severity: "error",
  category: "Correctness",
  requires: ["ssr"],
  recommendation:
    "Render the same initial output on the server and client, then switch after mount or use useSyncExternalStore with a stable server snapshot.",
  create: (context: RuleContext): RuleVisitors => {
    if (isTestlikeFilename(context.filename)) return {};
    if (classifyReactNativeFileTarget(context) === "react-native") return {};
    let fileHasUseClientDirective = false;
    let fileIsEmailTemplate = false;
    const reportedNodes = new Set<EsTreeNode>();

    const reportHydrationBranch = (
      predicateNode: EsTreeNode,
      leftBranch: EsTreeNode,
      rightBranch: EsTreeNode,
      requiresRenderedContext: boolean,
    ): void => {
      if (reportedNodes.has(predicateNode)) return;
      const predicateMatch = matchBrowserPredicate(predicateNode, context);
      if (!predicateMatch) return;
      if (areRenderedBranchesEquivalent(leftBranch, rightBranch)) return;
      const componentOrHookNode = findRenderPhaseComponentOrHook(predicateNode);
      if (!componentOrHookNode) return;
      if (!hasClientRenderEvidence(componentOrHookNode, fileHasUseClientDirective)) return;
      if (requiresRenderedContext && !isInRenderedOutput(predicateNode, componentOrHookNode))
        return;
      if (!isRenderedValue(leftBranch) && !isRenderedValue(rightBranch)) {
        const attribute = findEnclosingJsxAttribute(predicateNode);
        if (!attribute || isEventHandlerAttribute(attribute)) return;
      }
      if (fileIsEmailTemplate || isInsideClientOnlyGuard(predicateNode)) return;
      const openingElement = findEnclosingJsxOpeningElement(predicateNode);
      if (hasSuppressHydrationWarningAttribute(openingElement)) return;
      if (branchHasSuppression(leftBranch) || branchHasSuppression(rightBranch)) return;
      if (isGeneratedImageRenderContext(context, openingElement ?? leftBranch)) {
        return;
      }
      reportedNodes.add(predicateNode);
      context.report({
        node: predicateNode,
        message: `\`typeof ${predicateMatch.browserGlobalName}\` selects different rendered output on the server and during hydration. Render the same initial output, then switch after mount.`,
      });
    };

    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        fileHasUseClientDirective = hasDirective(node, "use client");
        fileIsEmailTemplate = hasEmailTemplateImport(node);
      },
      ConditionalExpression(node: EsTreeNodeOfType<"ConditionalExpression">) {
        reportHydrationBranch(node.test, node.consequent, node.alternate, true);
      },
      LogicalExpression(node: EsTreeNodeOfType<"LogicalExpression">) {
        if (node.operator !== "&&" && node.operator !== "||") return;
        const predicateMatch = matchBrowserPredicate(node.left, context);
        if (!predicateMatch || !isRenderedValue(node.right)) return;
        reportHydrationBranch(node.left, node.right, node.left, true);
      },
      IfStatement(node: EsTreeNodeOfType<"IfStatement">) {
        const consequentValue = getReturnedValue(node.consequent);
        const alternateValue = getReturnedValue(node.alternate) ?? findFollowingReturnValue(node);
        if (!consequentValue || !alternateValue) return;
        if (!isRenderedValue(consequentValue) && !isRenderedValue(alternateValue)) return;
        const componentOrHookNode = findRenderPhaseComponentOrHook(node.test);
        if (!componentOrHookNode) return;
        const enclosingFunction = findEnclosingFunction(node);
        if (
          enclosingFunction !== componentOrHookNode &&
          (!enclosingFunction || !isInRenderedOutput(enclosingFunction, componentOrHookNode))
        ) {
          return;
        }
        reportHydrationBranch(node.test, consequentValue, alternateValue, false);
      },
    };
  },
});
