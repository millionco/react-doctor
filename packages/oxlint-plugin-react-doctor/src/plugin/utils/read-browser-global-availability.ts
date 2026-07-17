import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import type { RuleContext } from "./rule-context.js";
import { stripParenExpression } from "./strip-paren-expression.js";

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

export const readBrowserGlobalAvailability = (
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
    return readBrowserGlobalAvailability(
      unwrappedExpression.argument,
      browserGlobalName,
      context,
      !predicateResult,
    );
  }
  if (isNodeOfType(unwrappedExpression, "LogicalExpression")) {
    if (unwrappedExpression.operator === "&&" && predicateResult) {
      return mergeAvailability(
        readBrowserGlobalAvailability(unwrappedExpression.left, browserGlobalName, context, true),
        readBrowserGlobalAvailability(unwrappedExpression.right, browserGlobalName, context, true),
      );
    }
    if (unwrappedExpression.operator === "||" && !predicateResult) {
      return mergeAvailability(
        readBrowserGlobalAvailability(unwrappedExpression.left, browserGlobalName, context, false),
        readBrowserGlobalAvailability(unwrappedExpression.right, browserGlobalName, context, false),
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
