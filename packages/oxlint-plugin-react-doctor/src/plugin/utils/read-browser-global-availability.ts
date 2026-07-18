import type { SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getSingleReturnExpression } from "./get-single-return-expression.js";
import { isFunctionLike } from "./is-function-like.js";
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

const hasSymbolWrite = (symbol: SymbolDescriptor): boolean =>
  symbol.references.some((reference) => reference.flag !== "read");

const readBrowserGlobalAvailabilityInternal = (
  expression: EsTreeNode,
  browserGlobalName: string,
  context: RuleContext,
  predicateResult: boolean,
  visitedSymbolIds: ReadonlySet<number>,
): boolean | null => {
  const unwrappedExpression = stripParenExpression(expression);
  if (
    isNodeOfType(unwrappedExpression, "UnaryExpression") &&
    unwrappedExpression.operator === "!"
  ) {
    return readBrowserGlobalAvailabilityInternal(
      unwrappedExpression.argument,
      browserGlobalName,
      context,
      !predicateResult,
      visitedSymbolIds,
    );
  }
  if (isNodeOfType(unwrappedExpression, "LogicalExpression")) {
    if (unwrappedExpression.operator === "&&" && predicateResult) {
      return mergeAvailability(
        readBrowserGlobalAvailabilityInternal(
          unwrappedExpression.left,
          browserGlobalName,
          context,
          true,
          new Set(visitedSymbolIds),
        ),
        readBrowserGlobalAvailabilityInternal(
          unwrappedExpression.right,
          browserGlobalName,
          context,
          true,
          new Set(visitedSymbolIds),
        ),
      );
    }
    if (unwrappedExpression.operator === "||" && !predicateResult) {
      return mergeAvailability(
        readBrowserGlobalAvailabilityInternal(
          unwrappedExpression.left,
          browserGlobalName,
          context,
          false,
          new Set(visitedSymbolIds),
        ),
        readBrowserGlobalAvailabilityInternal(
          unwrappedExpression.right,
          browserGlobalName,
          context,
          false,
          new Set(visitedSymbolIds),
        ),
      );
    }
    return null;
  }
  if (isNodeOfType(unwrappedExpression, "Identifier")) {
    const symbol = context.scopes.symbolFor(unwrappedExpression);
    if (
      !symbol ||
      symbol.kind !== "const" ||
      !symbol.initializer ||
      visitedSymbolIds.has(symbol.id) ||
      hasSymbolWrite(symbol)
    ) {
      return null;
    }
    return readBrowserGlobalAvailabilityInternal(
      symbol.initializer,
      browserGlobalName,
      context,
      predicateResult,
      new Set([...visitedSymbolIds, symbol.id]),
    );
  }
  if (isNodeOfType(unwrappedExpression, "CallExpression")) {
    const callee = stripParenExpression(unwrappedExpression.callee);
    if (!isNodeOfType(callee, "Identifier") || unwrappedExpression.arguments.length > 0) {
      return null;
    }
    const symbol = context.scopes.symbolFor(callee);
    if (!symbol || visitedSymbolIds.has(symbol.id) || hasSymbolWrite(symbol)) return null;
    const functionNode =
      symbol.kind === "function"
        ? symbol.declarationNode
        : symbol.kind === "const" && symbol.initializer
          ? stripParenExpression(symbol.initializer)
          : null;
    if (
      !functionNode ||
      !isFunctionLike(functionNode) ||
      functionNode.async ||
      functionNode.generator ||
      functionNode.params.length > 0
    ) {
      return null;
    }
    const returnedExpression = getSingleReturnExpression(functionNode);
    if (!returnedExpression) return null;
    return readBrowserGlobalAvailabilityInternal(
      returnedExpression,
      browserGlobalName,
      context,
      predicateResult,
      new Set([...visitedSymbolIds, symbol.id]),
    );
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

export const readBrowserGlobalAvailability = (
  expression: EsTreeNode,
  browserGlobalName: string,
  context: RuleContext,
  predicateResult: boolean,
): boolean | null =>
  readBrowserGlobalAvailabilityInternal(
    expression,
    browserGlobalName,
    context,
    predicateResult,
    new Set(),
  );
