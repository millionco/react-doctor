import { defineRule } from "../../utils/define-rule.js";
import { executesDuringRender } from "../../utils/executes-during-render.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { findEnclosingJsxOpeningElement } from "../../utils/find-enclosing-jsx-opening-element.js";
import { findRenderPhaseComponentOrHook } from "../../utils/find-render-phase-component-or-hook.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { hasEmailTemplateImport } from "../../utils/has-email-template-import.js";
import { isAfterClientOnlyEarlyReturn } from "../../utils/is-after-client-only-early-return.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isGatedByFalsyInitialState } from "../../utils/is-gated-by-falsy-initial-state.js";
import { isGeneratedImageRenderContext } from "../../utils/is-generated-image-render-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { classifyReactNativeFileTarget } from "../../utils/is-react-native-file.js";
import { isTestlikeFilename } from "../../utils/is-testlike-filename.js";
import { statementAlwaysExits } from "../../utils/statement-always-exits.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { RuleVisitors } from "../../utils/rule-visitors.js";

const BROWSER_GLOBAL_NAMES: ReadonlySet<string> = new Set([
  "window",
  "document",
  "localStorage",
  "sessionStorage",
  "navigator",
  "matchMedia",
]);

const getTypeofBrowserGlobalName = (
  expression: EsTreeNode,
  context: RuleContext,
): string | null => {
  const unwrappedExpression = stripParenExpression(expression);
  if (
    !isNodeOfType(unwrappedExpression, "UnaryExpression") ||
    unwrappedExpression.operator !== "typeof"
  ) {
    return null;
  }
  const argument = stripParenExpression(unwrappedExpression.argument);
  if (isNodeOfType(argument, "Identifier")) {
    return BROWSER_GLOBAL_NAMES.has(argument.name) && context.scopes.isGlobalReference(argument)
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
    !BROWSER_GLOBAL_NAMES.has(argument.property.name)
  ) {
    return null;
  }
  return argument.property.name;
};

const browserGuardCoversGlobal = (guardName: string, browserGlobalName: string): boolean =>
  guardName === browserGlobalName || guardName === "window" || guardName === "document";

const mergeAvailability = (
  leftAvailability: boolean | null,
  rightAvailability: boolean | null,
): boolean | null => {
  if (leftAvailability === null) return rightAvailability;
  if (rightAvailability === null) return leftAvailability;
  return leftAvailability === rightAvailability ? leftAvailability : null;
};

const readAvailabilityWhenPredicate = (
  expression: EsTreeNode,
  browserGlobalName: string,
  context: RuleContext,
  predicateResult: boolean,
): boolean | null => {
  const unwrappedExpression = stripParenExpression(expression);
  if (
    isNodeOfType(unwrappedExpression, "UnaryExpression") &&
    unwrappedExpression.operator === "!"
  ) {
    return readAvailabilityWhenPredicate(
      unwrappedExpression.argument,
      browserGlobalName,
      context,
      !predicateResult,
    );
  }
  if (isNodeOfType(unwrappedExpression, "LogicalExpression")) {
    if (unwrappedExpression.operator === "&&" && predicateResult) {
      return mergeAvailability(
        readAvailabilityWhenPredicate(unwrappedExpression.left, browserGlobalName, context, true),
        readAvailabilityWhenPredicate(unwrappedExpression.right, browserGlobalName, context, true),
      );
    }
    if (unwrappedExpression.operator === "||" && !predicateResult) {
      return mergeAvailability(
        readAvailabilityWhenPredicate(unwrappedExpression.left, browserGlobalName, context, false),
        readAvailabilityWhenPredicate(unwrappedExpression.right, browserGlobalName, context, false),
      );
    }
    return null;
  }
  if (!isNodeOfType(unwrappedExpression, "BinaryExpression")) return null;
  const leftTypeofName = getTypeofBrowserGlobalName(unwrappedExpression.left, context);
  const rightTypeofName = getTypeofBrowserGlobalName(unwrappedExpression.right, context);
  const leftComparedType =
    isNodeOfType(unwrappedExpression.left, "Literal") &&
    typeof unwrappedExpression.left.value === "string"
      ? unwrappedExpression.left.value
      : null;
  const rightComparedType =
    isNodeOfType(unwrappedExpression.right, "Literal") &&
    typeof unwrappedExpression.right.value === "string"
      ? unwrappedExpression.right.value
      : null;
  const guardName =
    leftTypeofName && rightComparedType
      ? leftTypeofName
      : rightTypeofName && leftComparedType
        ? rightTypeofName
        : null;
  const comparedType =
    leftTypeofName && rightComparedType
      ? rightComparedType
      : rightTypeofName && leftComparedType
        ? leftComparedType
        : null;
  if (!guardName || !browserGuardCoversGlobal(guardName, browserGlobalName)) return null;
  if (!comparedType) return null;
  const isEquality =
    unwrappedExpression.operator === "===" || unwrappedExpression.operator === "==";
  const isInequality =
    unwrappedExpression.operator === "!==" || unwrappedExpression.operator === "!=";
  if (!isEquality && !isInequality) return null;
  const browserType = guardName === "matchMedia" ? "function" : "object";
  const browserResult = isEquality ? browserType === comparedType : browserType !== comparedType;
  const serverResult = isEquality ? comparedType === "undefined" : comparedType !== "undefined";
  if (browserResult === serverResult) return null;
  return predicateResult === browserResult;
};

const isInsideAvailabilityGuard = (
  node: EsTreeNode,
  browserGlobalName: string,
  context: RuleContext,
): boolean => {
  let currentNode = node;
  let parentNode = currentNode.parent;
  while (parentNode) {
    if (isFunctionLike(parentNode) && !executesDuringRender(parentNode, context.scopes)) break;
    if (
      isNodeOfType(parentNode, "LogicalExpression") &&
      (parentNode.operator === "&&" || parentNode.operator === "||") &&
      parentNode.right === currentNode &&
      readAvailabilityWhenPredicate(
        parentNode.left,
        browserGlobalName,
        context,
        parentNode.operator === "&&",
      ) === true
    ) {
      return true;
    }
    if (isNodeOfType(parentNode, "ConditionalExpression")) {
      if (
        (parentNode.consequent === currentNode &&
          readAvailabilityWhenPredicate(parentNode.test, browserGlobalName, context, true) ===
            true) ||
        (parentNode.alternate === currentNode &&
          readAvailabilityWhenPredicate(parentNode.test, browserGlobalName, context, false) ===
            true)
      ) {
        return true;
      }
    }
    if (isNodeOfType(parentNode, "IfStatement")) {
      if (
        (parentNode.consequent === currentNode &&
          readAvailabilityWhenPredicate(parentNode.test, browserGlobalName, context, true) ===
            true) ||
        (parentNode.alternate === currentNode &&
          readAvailabilityWhenPredicate(parentNode.test, browserGlobalName, context, false) ===
            true)
      ) {
        return true;
      }
    }
    currentNode = parentNode;
    parentNode = currentNode.parent;
  }
  return false;
};

const isAfterAvailabilityEarlyExit = (
  node: EsTreeNode,
  componentOrHookNode: EsTreeNode,
  browserGlobalName: string,
  context: RuleContext,
): boolean => {
  const enclosingFunction = findEnclosingFunction(node);
  if (
    !enclosingFunction ||
    (enclosingFunction !== componentOrHookNode &&
      !executesDuringRender(enclosingFunction, context.scopes)) ||
    !isFunctionLike(enclosingFunction) ||
    !isNodeOfType(enclosingFunction.body, "BlockStatement")
  ) {
    return false;
  }

  let currentNode: EsTreeNode = node;
  while (currentNode !== enclosingFunction) {
    const parentNode = currentNode.parent;
    if (!parentNode) return false;
    if (isNodeOfType(parentNode, "BlockStatement")) {
      for (const statement of parentNode.body) {
        if (statement === currentNode) break;
        if (!isNodeOfType(statement, "IfStatement")) continue;
        if (
          readAvailabilityWhenPredicate(statement.test, browserGlobalName, context, false) ===
            true &&
          statementAlwaysExits(statement.consequent)
        ) {
          return true;
        }
        if (
          readAvailabilityWhenPredicate(statement.test, browserGlobalName, context, true) ===
            true &&
          statement.alternate &&
          statementAlwaysExits(statement.alternate)
        ) {
          return true;
        }
      }
    }
    currentNode = parentNode;
  }
  return false;
};

const isTypeofProbe = (node: EsTreeNode): boolean => {
  const expressionRoot = findTransparentExpressionRoot(node);
  const parentNode = expressionRoot.parent;
  return (
    isNodeOfType(parentNode, "UnaryExpression") &&
    parentNode.operator === "typeof" &&
    parentNode.argument === expressionRoot
  );
};

export const noUnguardedBrowserGlobalInRenderOrHookInit = defineRule({
  id: "no-unguarded-browser-global-in-render-or-hook-init",
  title: "Browser global read during server render",
  severity: "error",
  category: "Correctness",
  requires: ["ssr"],
  recommendation:
    "Move browser-only reads into an effect or event, guard them behind a client-only render path, or use useSyncExternalStore with a stable server snapshot.",
  create: (context: RuleContext): RuleVisitors => {
    if (isTestlikeFilename(context.filename)) return {};
    if (classifyReactNativeFileTarget(context) === "react-native") return {};
    let fileIsEmailTemplate = false;
    const reportedNodes = new Set<EsTreeNode>();

    const reportBrowserRead = (node: EsTreeNode, browserGlobalName: string): void => {
      if (reportedNodes.has(node) || isTypeofProbe(node)) return;
      const componentOrHookNode = findRenderPhaseComponentOrHook(node, context.scopes);
      if (!componentOrHookNode) return;
      if (fileIsEmailTemplate) return;
      if (isGeneratedImageRenderContext(context, findEnclosingJsxOpeningElement(node) ?? node)) {
        return;
      }
      if (isGatedByFalsyInitialState(node, context.scopes)) return;
      if (isAfterClientOnlyEarlyReturn(node, componentOrHookNode, context.scopes)) return;
      if (isInsideAvailabilityGuard(node, browserGlobalName, context)) return;
      if (isAfterAvailabilityEarlyExit(node, componentOrHookNode, browserGlobalName, context))
        return;
      reportedNodes.add(node);
      context.report({
        node,
        message: `\`${browserGlobalName}\` is read while React is rendering on the server, where browser globals are unavailable. Move the read into an effect or event, or provide a stable server snapshot.`,
      });
    };

    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        fileIsEmailTemplate = hasEmailTemplateImport(node);
      },
      Identifier(node: EsTreeNodeOfType<"Identifier">) {
        if (!BROWSER_GLOBAL_NAMES.has(node.name)) return;
        if (!context.scopes.isGlobalReference(node)) return;
        reportBrowserRead(node, node.name);
      },
      MemberExpression(node: EsTreeNodeOfType<"MemberExpression">) {
        if (node.computed) return;
        const objectNode = stripParenExpression(node.object);
        if (
          !isNodeOfType(objectNode, "Identifier") ||
          objectNode.name !== "globalThis" ||
          !context.scopes.isGlobalReference(objectNode) ||
          !isNodeOfType(node.property, "Identifier") ||
          !BROWSER_GLOBAL_NAMES.has(node.property.name)
        ) {
          return;
        }
        reportBrowserRead(node, node.property.name);
      },
    };
  },
});
