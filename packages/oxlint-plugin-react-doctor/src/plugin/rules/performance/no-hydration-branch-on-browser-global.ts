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
import { isEventHandlerAttribute } from "../../utils/is-event-handler-attribute.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { classifyReactNativeFileTarget } from "../../utils/is-react-native-file.js";
import { isTestlikeFilename } from "../../utils/is-testlike-filename.js";
import { readInitialStateBoolean } from "../../utils/read-initial-state-boolean.js";
import { statementAlwaysExits } from "../../utils/statement-always-exits.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { RuleVisitors } from "../../utils/rule-visitors.js";

interface BrowserPredicateMatch {
  readonly browserGlobalName: "window" | "document";
  readonly clientResult: boolean;
  readonly serverResult: boolean;
}

interface HydrationConditionMatch {
  readonly predicateMatch: BrowserPredicateMatch;
  readonly predicateNode: EsTreeNode;
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
  if (isNodeOfType(argument, "Identifier")) {
    return (argument.name === "window" || argument.name === "document") &&
      context.scopes.isGlobalReference(argument)
      ? argument.name
      : null;
  }
  if (
    !isNodeOfType(argument, "MemberExpression") ||
    argument.computed ||
    !isNodeOfType(argument.object, "Identifier") ||
    argument.object.name !== "globalThis" ||
    !context.scopes.isGlobalReference(argument.object) ||
    !isNodeOfType(argument.property, "Identifier") ||
    (argument.property.name !== "window" && argument.property.name !== "document")
  ) {
    return null;
  }
  return argument.property.name;
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

const readLogicalConditionResult = (
  operator: "&&" | "||",
  leftResult: boolean | null,
  rightResult: boolean | null,
): boolean | null => {
  if (operator === "&&") {
    if (leftResult === false || rightResult === false) return false;
    if (leftResult === true && rightResult === true) return true;
    return null;
  }
  if (leftResult === true || rightResult === true) return true;
  if (leftResult === false && rightResult === false) return false;
  return null;
};

const readHydrationConditionResult = (
  expression: EsTreeNode,
  context: RuleContext,
  runtime: "client" | "server",
): boolean | null => {
  const unwrappedExpression = stripParenExpression(expression);
  const predicateMatch = matchBrowserPredicate(unwrappedExpression, context);
  if (predicateMatch) return predicateMatch[`${runtime}Result`];
  const staticResult = readInitialStateBoolean(unwrappedExpression, context.scopes);
  if (staticResult !== null) return staticResult;
  if (
    isNodeOfType(unwrappedExpression, "UnaryExpression") &&
    unwrappedExpression.operator === "!"
  ) {
    const argumentResult = readHydrationConditionResult(
      unwrappedExpression.argument,
      context,
      runtime,
    );
    return argumentResult === null ? null : !argumentResult;
  }
  if (
    !isNodeOfType(unwrappedExpression, "LogicalExpression") ||
    (unwrappedExpression.operator !== "&&" && unwrappedExpression.operator !== "||")
  ) {
    return null;
  }
  return readLogicalConditionResult(
    unwrappedExpression.operator,
    readHydrationConditionResult(unwrappedExpression.left, context, runtime),
    readHydrationConditionResult(unwrappedExpression.right, context, runtime),
  );
};

const matchHydrationCondition = (
  expression: EsTreeNode,
  context: RuleContext,
): HydrationConditionMatch | null => {
  const unwrappedExpression = stripParenExpression(expression);
  const predicateMatch = matchBrowserPredicate(unwrappedExpression, context);
  if (predicateMatch) return { predicateMatch, predicateNode: unwrappedExpression };
  if (
    isNodeOfType(unwrappedExpression, "UnaryExpression") &&
    unwrappedExpression.operator === "!"
  ) {
    return matchHydrationCondition(unwrappedExpression.argument, context);
  }
  if (
    !isNodeOfType(unwrappedExpression, "LogicalExpression") ||
    (unwrappedExpression.operator !== "&&" && unwrappedExpression.operator !== "||")
  ) {
    return null;
  }
  const leftMatch = matchHydrationCondition(unwrappedExpression.left, context);
  const rightMatch = matchHydrationCondition(unwrappedExpression.right, context);
  if (leftMatch && rightMatch) {
    const clientResult = readHydrationConditionResult(unwrappedExpression, context, "client");
    const serverResult = readHydrationConditionResult(unwrappedExpression, context, "server");
    return clientResult !== null && serverResult !== null && clientResult !== serverResult
      ? leftMatch
      : null;
  }
  const nestedMatch = leftMatch ?? rightMatch;
  if (!nestedMatch) return null;
  const otherOperand = leftMatch ? unwrappedExpression.right : unwrappedExpression.left;
  const otherResult = readInitialStateBoolean(otherOperand, context.scopes);
  if (
    (unwrappedExpression.operator === "&&" && otherResult === false) ||
    (unwrappedExpression.operator === "||" && otherResult === true)
  ) {
    return null;
  }
  return nestedMatch;
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

const isInRenderedOutput = (
  node: EsTreeNode,
  componentOrHookNode: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
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
    if (isFunctionLike(parentNode) && !executesDuringRender(parentNode, scopes)) return false;
    currentNode = parentNode;
    parentNode = currentNode.parent;
  }
  return false;
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
    if (statementAlwaysExits(childStatement)) break;
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
    if (statementAlwaysExits(statement)) break;
  }
  return returnedValues;
};

const areConditionExpressionsEquivalent = (
  leftExpression: EsTreeNode,
  rightExpression: EsTreeNode,
): boolean => {
  const left = stripParenExpression(leftExpression);
  const right = stripParenExpression(rightExpression);
  if (areExpressionsStructurallyEqual(left, right)) return true;
  if (left.type !== right.type) return false;
  if (isNodeOfType(left, "UnaryExpression") && isNodeOfType(right, "UnaryExpression")) {
    return (
      left.operator === right.operator &&
      areConditionExpressionsEquivalent(left.argument, right.argument)
    );
  }
  if (isNodeOfType(left, "LogicalExpression") && isNodeOfType(right, "LogicalExpression")) {
    return (
      left.operator === right.operator &&
      areConditionExpressionsEquivalent(left.left, right.left) &&
      areConditionExpressionsEquivalent(left.right, right.right)
    );
  }
  if (isNodeOfType(left, "BinaryExpression") && isNodeOfType(right, "BinaryExpression")) {
    return (
      left.operator === right.operator &&
      areConditionExpressionsEquivalent(left.left, right.left) &&
      areConditionExpressionsEquivalent(left.right, right.right)
    );
  }
  return false;
};

const areReturnTreesEquivalent = (
  leftStatement: EsTreeNode | null | undefined,
  rightStatement: EsTreeNode | null | undefined,
): boolean => {
  if (!leftStatement || !rightStatement) return leftStatement === rightStatement;
  if (
    isNodeOfType(leftStatement, "ReturnStatement") &&
    isNodeOfType(rightStatement, "ReturnStatement")
  ) {
    return areRenderedBranchesEquivalent(leftStatement.argument, rightStatement.argument);
  }
  if (isNodeOfType(leftStatement, "IfStatement") && isNodeOfType(rightStatement, "IfStatement")) {
    return (
      areConditionExpressionsEquivalent(leftStatement.test, rightStatement.test) &&
      areReturnTreesEquivalent(leftStatement.consequent, rightStatement.consequent) &&
      areReturnTreesEquivalent(leftStatement.alternate, rightStatement.alternate)
    );
  }
  if (
    !isNodeOfType(leftStatement, "BlockStatement") ||
    !isNodeOfType(rightStatement, "BlockStatement")
  ) {
    return false;
  }
  const leftReturningStatements = leftStatement.body.filter(
    (statement) => getReturnedValues(statement).length > 0,
  );
  const rightReturningStatements = rightStatement.body.filter(
    (statement) => getReturnedValues(statement).length > 0,
  );
  return (
    leftReturningStatements.length === rightReturningStatements.length &&
    leftReturningStatements.every((statement, index) =>
      areReturnTreesEquivalent(statement, rightReturningStatements[index]),
    )
  );
};

const isStructuralRenderedValue = (node: EsTreeNode | null): boolean => {
  if (!node) return false;
  const unwrappedNode = stripParenExpression(node);
  return isNodeOfType(unwrappedNode, "JSXElement") || isNodeOfType(unwrappedNode, "JSXFragment");
};

const branchRootsSuppressSameElement = (
  leftBranch: EsTreeNode,
  rightBranch: EsTreeNode | null,
): boolean => {
  if (!rightBranch) return false;
  const left = stripParenExpression(leftBranch);
  const right = stripParenExpression(rightBranch);
  return (
    isNodeOfType(left, "JSXElement") &&
    isNodeOfType(right, "JSXElement") &&
    flattenJsxName(left.openingElement.name) === flattenJsxName(right.openingElement.name) &&
    hasSuppressHydrationWarningAttribute(left.openingElement) &&
    hasSuppressHydrationWarningAttribute(right.openingElement)
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
      conditionNode: EsTreeNode,
      leftBranch: EsTreeNode,
      rightBranch: EsTreeNode | null,
      requiresRenderedContext: boolean,
    ): void => {
      const conditionMatch = matchHydrationCondition(conditionNode, context);
      if (!conditionMatch) return;
      const { predicateMatch, predicateNode } = conditionMatch;
      if (reportedNodes.has(predicateNode)) return;
      if (rightBranch && areRenderedBranchesEquivalent(leftBranch, rightBranch)) return;
      const componentOrHookNode = findRenderPhaseComponentOrHook(predicateNode, context.scopes);
      if (!componentOrHookNode) return;
      if (!hasClientRenderEvidence(componentOrHookNode, fileHasUseClientDirective)) return;
      if (
        requiresRenderedContext &&
        !isInRenderedOutput(predicateNode, componentOrHookNode, context.scopes)
      )
        return;
      if (!isRenderedValue(leftBranch) && (!rightBranch || !isRenderedValue(rightBranch))) {
        const attribute = findEnclosingJsxAttribute(predicateNode);
        if (!attribute || isEventHandlerAttribute(attribute)) return;
      }
      if (fileIsEmailTemplate || isGatedByFalsyInitialState(predicateNode, context.scopes)) {
        return;
      }
      if (isAfterClientOnlyEarlyReturn(predicateNode, componentOrHookNode, context.scopes)) return;
      const openingElement = findEnclosingJsxOpeningElement(predicateNode);
      if (
        hasSuppressHydrationWarningAttribute(openingElement) &&
        !isStructuralRenderedValue(leftBranch) &&
        !isStructuralRenderedValue(rightBranch)
      ) {
        return;
      }
      if (branchRootsSuppressSameElement(leftBranch, rightBranch)) return;
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
        const renderedValue =
          node.operator === "&&"
            ? findRenderedValueInAndBranch(node.right)
            : isRenderedValue(node.right)
              ? node.right
              : null;
        if (!renderedValue) return;
        reportHydrationBranch(node, renderedValue, null, true);
      },
      IfStatement(node: EsTreeNodeOfType<"IfStatement">) {
        if (node.alternate && areReturnTreesEquivalent(node.consequent, node.alternate)) return;
        const consequentValues = getReturnedValues(node.consequent);
        const alternateValues = node.alternate
          ? getReturnedValues(node.alternate)
          : findFollowingReturnedValues(node);
        if (consequentValues.length === 0 || alternateValues.length === 0) return;
        const componentOrHookNode = findRenderPhaseComponentOrHook(node.test, context.scopes);
        if (!componentOrHookNode) return;
        const enclosingFunction = findEnclosingFunction(node);
        if (
          enclosingFunction !== componentOrHookNode &&
          (!enclosingFunction ||
            !isInRenderedOutput(enclosingFunction, componentOrHookNode, context.scopes))
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
