import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeConditionallyExecuted } from "../../utils/is-node-conditionally-executed.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import { resolveR3fCallback } from "./utils/resolve-r3f-callback.js";
import { getApiReferenceModuleSource } from "./utils/get-api-reference-module-source.js";
import { walkFunctionExecution } from "./utils/walk-function-execution.js";

const TRANSFORM_PROPERTIES = new Set(["position", "rotation", "scale", "quaternion"]);
const INTERPOLATION_RECEIVER_PROPERTIES = new Set([...TRANSFORM_PROPERTIES, "color"]);
const INTERPOLATION_FACTOR_ARGUMENT_BY_METHOD = new Map([
  ["lerp", 1],
  ["lerpColors", 2],
  ["lerpHSL", 1],
  ["lerpVectors", 2],
  ["slerp", 1],
  ["slerpQuaternions", 2],
]);

const isTransformMember = (expression: EsTreeNode): boolean => {
  let current = stripParenExpression(expression);
  while (isNodeOfType(current, "MemberExpression")) {
    if (TRANSFORM_PROPERTIES.has(getStaticPropertyName(current) ?? "")) return true;
    current = stripParenExpression(current.object);
  }
  return false;
};

const expressionReferencesDelta = (
  expression: EsTreeNode,
  callback: EsTreeNode,
  context: RuleContext,
  visitedSymbolIds: Set<number> = new Set(),
): boolean => {
  if (!isFunctionLike(callback)) return false;
  const deltaParameter = callback.params[1];
  const deltaBinding = isNodeOfType(deltaParameter, "AssignmentPattern")
    ? deltaParameter.left
    : deltaParameter;
  const deltaSymbol = isNodeOfType(deltaBinding, "Identifier")
    ? context.scopes.symbolFor(deltaBinding)
    : null;
  let referencesDelta = false;
  walkAst(expression, (candidate) => {
    if (!isNodeOfType(candidate, "Identifier")) return;
    const symbol = context.scopes.symbolFor(candidate);
    if (deltaSymbol && symbol?.id === deltaSymbol.id) {
      referencesDelta = true;
      return false;
    }
    if (
      symbol?.kind !== "const" ||
      !symbol.initializer ||
      visitedSymbolIds.has(symbol.id) ||
      symbol.references.some((reference) => reference.flag !== "read")
    ) {
      return;
    }
    visitedSymbolIds.add(symbol.id);
    if (expressionReferencesDelta(symbol.initializer, callback, context, visitedSymbolIds)) {
      referencesDelta = true;
      return false;
    }
  });
  return referencesDelta;
};

const resolveStaticNumber = (
  expression: EsTreeNode,
  context: RuleContext,
  visitedSymbolIds: Set<number> = new Set(),
): number | null => {
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "Literal") && typeof candidate.value === "number") {
    return Number.isFinite(candidate.value) ? candidate.value : null;
  }
  if (isNodeOfType(candidate, "Identifier")) {
    const symbol = context.scopes.symbolFor(candidate);
    if (
      symbol?.kind !== "const" ||
      !symbol.initializer ||
      visitedSymbolIds.has(symbol.id) ||
      symbol.references.some((reference) => reference.flag !== "read")
    ) {
      return null;
    }
    visitedSymbolIds.add(symbol.id);
    return resolveStaticNumber(symbol.initializer, context, visitedSymbolIds);
  }
  if (isNodeOfType(candidate, "UnaryExpression")) {
    const argument = resolveStaticNumber(candidate.argument, context, visitedSymbolIds);
    if (argument === null) return null;
    if (candidate.operator === "+") return argument;
    if (candidate.operator === "-") return -argument;
    return null;
  }
  if (!isNodeOfType(candidate, "BinaryExpression")) return null;
  const left = resolveStaticNumber(candidate.left, context, new Set(visitedSymbolIds));
  const right = resolveStaticNumber(candidate.right, context, new Set(visitedSymbolIds));
  if (left === null || right === null) return null;
  let result: number | null = null;
  if (candidate.operator === "+") result = left + right;
  if (candidate.operator === "-") result = left - right;
  if (candidate.operator === "*") result = left * right;
  if (candidate.operator === "/") result = left / right;
  if (candidate.operator === "**") result = left ** right;
  return result !== null && Number.isFinite(result) ? result : null;
};

const isThreeMathUtils = (expression: EsTreeNode, context: RuleContext): boolean => {
  return getApiReferenceModuleSource(expression, "MathUtils", context.scopes) === "three";
};

const hasInterpolationReceiverProvenance = (expression: EsTreeNode): boolean => {
  let current = stripParenExpression(expression);
  while (isNodeOfType(current, "MemberExpression")) {
    const propertyName = getStaticPropertyName(current);
    if (propertyName === "current" || INTERPOLATION_RECEIVER_PROPERTIES.has(propertyName ?? "")) {
      return true;
    }
    current = stripParenExpression(current.object);
  }
  return false;
};

const getFixedInterpolationFactor = (
  node: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): EsTreeNode | null => {
  if (!isNodeOfType(node.callee, "MemberExpression")) return null;
  const methodName = getStaticPropertyName(node.callee);
  let factorArgumentIndex: number | undefined;
  if (methodName === "lerp" && isThreeMathUtils(node.callee.object, context)) {
    factorArgumentIndex = 2;
  } else if (methodName && hasInterpolationReceiverProvenance(node.callee.object)) {
    factorArgumentIndex = INTERPOLATION_FACTOR_ARGUMENT_BY_METHOD.get(methodName);
  }
  if (factorArgumentIndex === undefined) return null;
  const factor = node.arguments[factorArgumentIndex];
  if (!factor || isNodeOfType(factor, "SpreadElement")) return null;
  const staticFactor = resolveStaticNumber(factor, context);
  return staticFactor !== null && staticFactor > 0 && staticFactor < 1 ? factor : null;
};

export const r3fRequireFrameDelta = defineRule({
  id: "r3f-require-frame-delta",
  title: "Frame-rate-dependent animation",
  category: "Correctness",
  severity: "warn",
  recommendation:
    "Scale incremental transforms and interpolation by useFrame delta, use delta-aware damping, or assign from absolute time",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      const callback = resolveR3fCallback(node, "useFrame", context.scopes);
      if (!isFunctionLike(callback)) return;
      walkFunctionExecution(callback, context.scopes, (candidate) => {
        if (
          isNodeOfType(candidate, "UpdateExpression") &&
          isTransformMember(candidate.argument) &&
          !isNodeConditionallyExecuted(candidate, callback)
        ) {
          context.report({
            node: candidate,
            message:
              "This transform changes by a fixed amount per frame, so animation speed depends on refresh rate. Use the useFrame delta argument instead of an update operator",
          });
          return;
        }
        if (isNodeOfType(candidate, "AssignmentExpression")) {
          if (
            (candidate.operator !== "+=" && candidate.operator !== "-=") ||
            !isTransformMember(candidate.left) ||
            expressionReferencesDelta(candidate.right, callback, context) ||
            isNodeConditionallyExecuted(candidate, callback)
          ) {
            return;
          }
          context.report({
            node: candidate,
            message:
              "This transform changes by a fixed amount per frame, so animation speed depends on refresh rate. Multiply the increment by the useFrame delta argument",
          });
          return;
        }
        if (!isNodeOfType(candidate, "CallExpression")) return;
        const factor = getFixedInterpolationFactor(candidate, context);
        if (
          !factor ||
          expressionReferencesDelta(factor, callback, context) ||
          isNodeConditionallyExecuted(candidate, callback)
        ) {
          return;
        }
        context.report({
          node: factor,
          message:
            "This fixed interpolation factor converges once per frame, so its speed changes with refresh rate. Derive the factor from useFrame delta or use a delta-aware damping function",
        });
      });
    },
  }),
});
