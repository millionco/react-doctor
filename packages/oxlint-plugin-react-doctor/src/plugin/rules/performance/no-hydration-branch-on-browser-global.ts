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
import { isAfterClientOnlyEarlyReturn } from "../../utils/is-after-client-only-early-return.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isGatedByFalsyInitialState } from "../../utils/is-gated-by-falsy-initial-state.js";
import { isGeneratedImageRenderContext } from "../../utils/is-generated-image-render-context.js";
import { isInsideClientOnlyGuard } from "../../utils/is-inside-client-only-guard.js";
import { isEventHandlerAttribute } from "../../utils/is-event-handler-attribute.js";
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
  if (isNodeOfType(unwrappedNode, "Literal")) {
    return (
      unwrappedNode.value !== null &&
      unwrappedNode.value !== true &&
      unwrappedNode.value !== false &&
      unwrappedNode.value !== ""
    );
  }
  if (isNodeOfType(unwrappedNode, "TemplateLiteral")) {
    return unwrappedNode.expressions.length > 0 || unwrappedNode.quasis[0]?.value.cooked !== "";
  }
  return isNodeOfType(unwrappedNode, "JSXElement") || isNodeOfType(unwrappedNode, "JSXFragment");
};

const findBrowserPredicateInAndCondition = (
  node: EsTreeNode,
  context: RuleContext,
): EsTreeNode | null => {
  const unwrappedNode = stripParenExpression(node);
  if (matchBrowserPredicate(unwrappedNode, context)) return unwrappedNode;
  if (!isNodeOfType(unwrappedNode, "LogicalExpression") || unwrappedNode.operator !== "&&") {
    return null;
  }
  return (
    findBrowserPredicateInAndCondition(unwrappedNode.left, context) ??
    findBrowserPredicateInAndCondition(unwrappedNode.right, context)
  );
};

const findRenderedValueInAndBranch = (node: EsTreeNode): EsTreeNode | null => {
  const unwrappedNode = stripParenExpression(node);
  if (isRenderedValue(unwrappedNode)) return unwrappedNode;
  if (!isNodeOfType(unwrappedNode, "LogicalExpression") || unwrappedNode.operator !== "&&") {
    return null;
  }
  return findRenderedValueInAndBranch(unwrappedNode.right);
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

const statementAlwaysReturns = (statement: EsTreeNode): boolean => {
  if (isNodeOfType(statement, "ReturnStatement")) return true;
  if (isNodeOfType(statement, "IfStatement")) {
    return Boolean(
      statement.alternate &&
      statementAlwaysReturns(statement.consequent) &&
      statementAlwaysReturns(statement.alternate),
    );
  }
  if (!isNodeOfType(statement, "BlockStatement")) return false;
  return statement.body.some((childStatement) => statementAlwaysReturns(childStatement));
};

const getReturnedValues = (statement: EsTreeNode | null | undefined): ReadonlyArray<EsTreeNode> => {
  if (!statement) return [];
  if (isNodeOfType(statement, "ReturnStatement")) {
    return statement.argument ? [statement.argument] : [];
  }
  if (isNodeOfType(statement, "IfStatement")) {
    return [...getReturnedValues(statement.consequent), ...getReturnedValues(statement.alternate)];
  }
  if (!isNodeOfType(statement, "BlockStatement")) return [];
  const returnedValues: Array<EsTreeNode> = [];
  for (const childStatement of statement.body) {
    returnedValues.push(...getReturnedValues(childStatement));
    if (statementAlwaysReturns(childStatement)) break;
  }
  return returnedValues;
};

const findFollowingReturnedValues = (
  ifStatement: EsTreeNodeOfType<"IfStatement">,
): ReadonlyArray<EsTreeNode> => {
  const parentNode = ifStatement.parent;
  if (!isNodeOfType(parentNode, "BlockStatement")) return [];
  const statementIndex = parentNode.body.findIndex((statement) => statement === ifStatement);
  if (statementIndex < 0) return [];
  const returnedValues: Array<EsTreeNode> = [];
  for (const statement of parentNode.body.slice(statementIndex + 1)) {
    returnedValues.push(...getReturnedValues(statement));
    if (statementAlwaysReturns(statement)) break;
  }
  return returnedValues;
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
      rightBranch: EsTreeNode | null,
      requiresRenderedContext: boolean,
    ): void => {
      if (reportedNodes.has(predicateNode)) return;
      const predicateMatch = matchBrowserPredicate(predicateNode, context);
      if (!predicateMatch) return;
      if (rightBranch && areRenderedBranchesEquivalent(leftBranch, rightBranch)) return;
      const componentOrHookNode = findRenderPhaseComponentOrHook(predicateNode);
      if (!componentOrHookNode) return;
      if (!hasClientRenderEvidence(componentOrHookNode, fileHasUseClientDirective)) return;
      if (requiresRenderedContext && !isInRenderedOutput(predicateNode, componentOrHookNode))
        return;
      if (!isRenderedValue(leftBranch) && (!rightBranch || !isRenderedValue(rightBranch))) {
        const attribute = findEnclosingJsxAttribute(predicateNode);
        if (!attribute || isEventHandlerAttribute(attribute)) return;
      }
      if (
        fileIsEmailTemplate ||
        isInsideClientOnlyGuard(predicateNode) ||
        isGatedByFalsyInitialState(predicateNode)
      ) {
        return;
      }
      if (isAfterClientOnlyEarlyReturn(predicateNode, componentOrHookNode)) return;
      const openingElement = findEnclosingJsxOpeningElement(predicateNode);
      if (hasSuppressHydrationWarningAttribute(openingElement)) return;
      if (branchHasSuppression(leftBranch) || (rightBranch && branchHasSuppression(rightBranch)))
        return;
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
        const predicateNode =
          node.operator === "&&"
            ? findBrowserPredicateInAndCondition(node.left, context)
            : matchBrowserPredicate(node.left, context)
              ? stripParenExpression(node.left)
              : null;
        const renderedValue =
          node.operator === "&&"
            ? findRenderedValueInAndBranch(node.right)
            : isRenderedValue(node.right)
              ? node.right
              : null;
        if (!predicateNode || !renderedValue) return;
        reportHydrationBranch(predicateNode, renderedValue, null, true);
      },
      IfStatement(node: EsTreeNodeOfType<"IfStatement">) {
        const consequentValues = getReturnedValues(node.consequent);
        const alternateValues = node.alternate
          ? getReturnedValues(node.alternate)
          : findFollowingReturnedValues(node);
        if (consequentValues.length === 0 || alternateValues.length === 0) return;
        const componentOrHookNode = findRenderPhaseComponentOrHook(node.test);
        if (!componentOrHookNode) return;
        const enclosingFunction = findEnclosingFunction(node);
        if (
          enclosingFunction !== componentOrHookNode &&
          (!enclosingFunction || !isInRenderedOutput(enclosingFunction, componentOrHookNode))
        ) {
          return;
        }
        for (const consequentValue of consequentValues) {
          for (const alternateValue of alternateValues) {
            if (!isRenderedValue(consequentValue) && !isRenderedValue(alternateValue)) {
              continue;
            }
            reportHydrationBranch(node.test, consequentValue, alternateValue, false);
          }
        }
      },
    };
  },
});
