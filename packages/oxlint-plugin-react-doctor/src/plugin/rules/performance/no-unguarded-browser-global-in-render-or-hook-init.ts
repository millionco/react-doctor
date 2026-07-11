import { defineRule } from "../../utils/define-rule.js";
import { findEnclosingJsxOpeningElement } from "../../utils/find-enclosing-jsx-opening-element.js";
import { findRenderPhaseComponentOrHook } from "../../utils/find-render-phase-component-or-hook.js";
import { hasEmailTemplateImport } from "../../utils/has-email-template-import.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isGatedByFalsyInitialState } from "../../utils/is-gated-by-falsy-initial-state.js";
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
  if (
    !isNodeOfType(argument, "Identifier") ||
    !BROWSER_GLOBAL_NAMES.has(argument.name) ||
    !context.scopes.isGlobalReference(argument)
  ) {
    return null;
  }
  return argument.name;
};

const browserGuardCoversGlobal = (guardName: string, browserGlobalName: string): boolean =>
  guardName === browserGlobalName ||
  guardName === "window" ||
  (guardName === "document" && browserGlobalName === "document");

const readAvailabilityWhenPredicateTrue = (
  expression: EsTreeNode,
  browserGlobalName: string,
  context: RuleContext,
): boolean | null => {
  const unwrappedExpression = stripParenExpression(expression);
  if (
    isNodeOfType(unwrappedExpression, "UnaryExpression") &&
    unwrappedExpression.operator === "!"
  ) {
    const innerAvailability = readAvailabilityWhenPredicateTrue(
      unwrappedExpression.argument,
      browserGlobalName,
      context,
    );
    return innerAvailability === null ? null : !innerAvailability;
  }
  if (!isNodeOfType(unwrappedExpression, "BinaryExpression")) return null;
  const leftTypeofName = getTypeofBrowserGlobalName(unwrappedExpression.left, context);
  const rightTypeofName = getTypeofBrowserGlobalName(unwrappedExpression.right, context);
  const leftIsUndefined =
    isNodeOfType(unwrappedExpression.left, "Literal") &&
    unwrappedExpression.left.value === "undefined";
  const rightIsUndefined =
    isNodeOfType(unwrappedExpression.right, "Literal") &&
    unwrappedExpression.right.value === "undefined";
  const guardName =
    leftTypeofName && rightIsUndefined
      ? leftTypeofName
      : rightTypeofName && leftIsUndefined
        ? rightTypeofName
        : null;
  if (!guardName || !browserGuardCoversGlobal(guardName, browserGlobalName)) return null;
  if (unwrappedExpression.operator === "!==" || unwrappedExpression.operator === "!=") return true;
  if (unwrappedExpression.operator === "===" || unwrappedExpression.operator === "==") return false;
  return null;
};

const statementAlwaysExits = (statement: EsTreeNode): boolean => {
  if (isNodeOfType(statement, "ReturnStatement") || isNodeOfType(statement, "ThrowStatement")) {
    return true;
  }
  if (!isNodeOfType(statement, "BlockStatement")) return false;
  const lastStatement = statement.body.at(-1);
  return Boolean(lastStatement && statementAlwaysExits(lastStatement));
};

const isInsideAvailabilityGuard = (
  node: EsTreeNode,
  browserGlobalName: string,
  context: RuleContext,
): boolean => {
  let currentNode = node;
  let parentNode = currentNode.parent;
  while (parentNode) {
    if (isFunctionLike(parentNode)) break;
    if (
      isNodeOfType(parentNode, "LogicalExpression") &&
      parentNode.operator === "&&" &&
      parentNode.right === currentNode &&
      readAvailabilityWhenPredicateTrue(parentNode.left, browserGlobalName, context) === true
    ) {
      return true;
    }
    if (isNodeOfType(parentNode, "ConditionalExpression")) {
      const availability = readAvailabilityWhenPredicateTrue(
        parentNode.test,
        browserGlobalName,
        context,
      );
      if (
        (parentNode.consequent === currentNode && availability === true) ||
        (parentNode.alternate === currentNode && availability === false)
      ) {
        return true;
      }
    }
    if (isNodeOfType(parentNode, "IfStatement")) {
      const availability = readAvailabilityWhenPredicateTrue(
        parentNode.test,
        browserGlobalName,
        context,
      );
      if (
        (parentNode.consequent === currentNode && availability === true) ||
        (parentNode.alternate === currentNode && availability === false)
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
  if (
    !isFunctionLike(componentOrHookNode) ||
    !isNodeOfType(componentOrHookNode.body, "BlockStatement")
  ) {
    return false;
  }
  const ancestors = new Set<EsTreeNode>();
  let currentNode: EsTreeNode | null | undefined = node;
  while (currentNode) {
    ancestors.add(currentNode);
    currentNode = currentNode.parent;
  }
  for (const statement of componentOrHookNode.body.body) {
    if (ancestors.has(statement)) return false;
    if (!isNodeOfType(statement, "IfStatement")) continue;
    const availability = readAvailabilityWhenPredicateTrue(
      statement.test,
      browserGlobalName,
      context,
    );
    if (availability === false && statementAlwaysExits(statement.consequent)) return true;
    if (availability === true && statement.alternate && statementAlwaysExits(statement.alternate)) {
      return true;
    }
  }
  return false;
};

const isTypeofProbe = (node: EsTreeNode): boolean => {
  const parentNode = node.parent;
  return (
    isNodeOfType(parentNode, "UnaryExpression") &&
    parentNode.operator === "typeof" &&
    parentNode.argument === node
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
      const componentOrHookNode = findRenderPhaseComponentOrHook(node);
      if (!componentOrHookNode) return;
      if (fileIsEmailTemplate) return;
      if (isGeneratedImageRenderContext(context, findEnclosingJsxOpeningElement(node) ?? node)) {
        return;
      }
      if (isInsideClientOnlyGuard(node) || isGatedByFalsyInitialState(node)) return;
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
        reportBrowserRead(node, node.name === "matchMedia" ? "window" : node.name);
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
        reportBrowserRead(
          node,
          node.property.name === "matchMedia" ? "window" : node.property.name,
        );
      },
    };
  },
});
