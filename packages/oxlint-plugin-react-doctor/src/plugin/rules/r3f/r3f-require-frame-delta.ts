import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNullishExpression } from "../../utils/is-nullish-expression.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveReactRefSymbol } from "../../utils/react-ref-origin.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import { isR3fCallbackStateProperty } from "./utils/is-r3f-callback-state-property.js";
import { collectR3fHostRefSymbolIds } from "./utils/collect-r3f-host-ref-symbol-ids.js";
import { isR3fUseThreeStateProperty } from "./utils/is-r3f-use-three-state-property.js";
import { resolveR3fCallback } from "./utils/resolve-r3f-callback.js";
import { getApiReferenceModuleSource } from "./utils/get-api-reference-module-source.js";
import { walkFunctionExecution } from "./utils/walk-function-execution.js";

const TRANSFORM_PROPERTIES = new Set(["position", "rotation", "scale", "quaternion"]);
const INTERPOLATION_RECEIVER_PROPERTIES = new Set([...TRANSFORM_PROPERTIES, "color"]);
const TRANSFORMABLE_R3F_STATE_PROPERTIES = ["camera", "scene"];
const INTERPOLATION_FACTOR_ARGUMENT_BY_METHOD = new Map([
  ["lerp", 1],
  ["lerpColors", 2],
  ["lerpHSL", 1],
  ["lerpVectors", 2],
  ["slerp", 1],
  ["slerpQuaternions", 2],
]);

const hasR3fTransformProvenance = (
  expression: EsTreeNode,
  callback: EsTreeNode,
  managedRefSymbolIds: ReadonlySet<number>,
  context: RuleContext,
): boolean => {
  let current = stripParenExpression(expression);
  while (isNodeOfType(current, "MemberExpression")) {
    if (
      TRANSFORMABLE_R3F_STATE_PROPERTIES.some((propertyName) =>
        isR3fCallbackStateProperty(current, callback, propertyName, context.scopes),
      )
    ) {
      return true;
    }
    if (
      TRANSFORMABLE_R3F_STATE_PROPERTIES.some((propertyName) =>
        isR3fUseThreeStateProperty(current, propertyName, context),
      )
    ) {
      return true;
    }
    const refSymbol = resolveReactRefSymbol(current, context.scopes, {
      includeCreateRef: true,
      resolveNamedAliases: true,
    });
    if (refSymbol && managedRefSymbolIds.has(refSymbol.id)) return true;
    current = stripParenExpression(current.object);
  }
  return TRANSFORMABLE_R3F_STATE_PROPERTIES.some(
    (propertyName) =>
      isR3fCallbackStateProperty(current, callback, propertyName, context.scopes) ||
      isR3fUseThreeStateProperty(current, propertyName, context),
  );
};

const isTransformMember = (
  expression: EsTreeNode,
  callback: EsTreeNode,
  managedRefSymbolIds: ReadonlySet<number>,
  context: RuleContext,
): boolean => {
  let current = stripParenExpression(expression);
  let hasTransformProperty = false;
  while (isNodeOfType(current, "MemberExpression")) {
    if (TRANSFORM_PROPERTIES.has(getStaticPropertyName(current) ?? "")) {
      hasTransformProperty = true;
    }
    current = stripParenExpression(current.object);
  }
  return (
    hasTransformProperty &&
    hasR3fTransformProvenance(expression, callback, managedRefSymbolIds, context)
  );
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

const hasInterpolationReceiverProvenance = (
  expression: EsTreeNode,
  callback: EsTreeNode,
  managedRefSymbolIds: ReadonlySet<number>,
  context: RuleContext,
): boolean => {
  let current = stripParenExpression(expression);
  let hasInterpolationProperty = false;
  while (isNodeOfType(current, "MemberExpression")) {
    const propertyName = getStaticPropertyName(current);
    if (INTERPOLATION_RECEIVER_PROPERTIES.has(propertyName ?? "")) {
      hasInterpolationProperty = true;
    }
    const refSymbol = resolveReactRefSymbol(current, context.scopes, {
      includeCreateRef: true,
      resolveNamedAliases: true,
    });
    if (refSymbol && managedRefSymbolIds.has(refSymbol.id)) return true;
    current = stripParenExpression(current.object);
  }
  return (
    hasInterpolationProperty &&
    hasR3fTransformProvenance(expression, callback, managedRefSymbolIds, context)
  );
};

const isReactRefAvailabilityCondition = (
  expression: EsTreeNode,
  didConditionPass: boolean,
  context: RuleContext,
): boolean => {
  const candidate = stripParenExpression(expression);
  if (resolveReactRefSymbol(candidate, context.scopes)) return didConditionPass;
  if (isNodeOfType(candidate, "UnaryExpression") && candidate.operator === "!") {
    return isReactRefAvailabilityCondition(candidate.argument, !didConditionPass, context);
  }
  if (
    !isNodeOfType(candidate, "BinaryExpression") ||
    !["==", "===", "!=", "!=="].includes(candidate.operator)
  ) {
    return false;
  }
  const refExpression = isNullishExpression(stripParenExpression(candidate.left))
    ? candidate.right
    : isNullishExpression(stripParenExpression(candidate.right))
      ? candidate.left
      : null;
  if (
    !refExpression ||
    !resolveReactRefSymbol(stripParenExpression(refExpression), context.scopes)
  ) {
    return false;
  }
  const isInequality = candidate.operator === "!=" || candidate.operator === "!==";
  return didConditionPass === isInequality;
};

const isConditionallyExecutedOnlyByReactRefAvailability = (
  node: EsTreeNode,
  callback: EsTreeNode,
  context: RuleContext,
): boolean => {
  let didFindRefAvailabilityCondition = false;
  let currentChild = node;
  let currentAncestor = node.parent ?? null;
  while (currentAncestor && currentAncestor !== callback) {
    if (isFunctionLike(currentAncestor)) return false;
    if (isNodeOfType(currentAncestor, "IfStatement") && currentAncestor.test !== currentChild) {
      const didConditionPass = currentAncestor.consequent === currentChild;
      if (
        (!didConditionPass && currentAncestor.alternate !== currentChild) ||
        !isReactRefAvailabilityCondition(currentAncestor.test, didConditionPass, context)
      ) {
        return false;
      }
      didFindRefAvailabilityCondition = true;
    }
    if (
      isNodeOfType(currentAncestor, "ConditionalExpression") &&
      (currentAncestor.consequent === currentChild || currentAncestor.alternate === currentChild)
    ) {
      const didConditionPass = currentAncestor.consequent === currentChild;
      if (!isReactRefAvailabilityCondition(currentAncestor.test, didConditionPass, context)) {
        return false;
      }
      didFindRefAvailabilityCondition = true;
    }
    if (
      isNodeOfType(currentAncestor, "LogicalExpression") &&
      currentAncestor.right === currentChild
    ) {
      if (
        currentAncestor.operator === "??" ||
        !isReactRefAvailabilityCondition(
          currentAncestor.left,
          currentAncestor.operator === "&&",
          context,
        )
      ) {
        return false;
      }
      didFindRefAvailabilityCondition = true;
    }
    if (
      isNodeOfType(currentAncestor, "AssignmentPattern") &&
      currentAncestor.right === currentChild
    ) {
      return false;
    }
    if (isNodeOfType(currentAncestor, "SwitchCase")) return false;
    currentChild = currentAncestor;
    currentAncestor = currentAncestor.parent ?? null;
  }
  return didFindRefAvailabilityCondition;
};

const getFixedInterpolationFactor = (
  node: EsTreeNodeOfType<"CallExpression">,
  callback: EsTreeNode,
  managedRefSymbolIds: ReadonlySet<number>,
  context: RuleContext,
): EsTreeNode | null => {
  if (!isNodeOfType(node.callee, "MemberExpression")) return null;
  const methodName = getStaticPropertyName(node.callee);
  let factorArgumentIndex: number | undefined;
  if (methodName === "lerp" && isThreeMathUtils(node.callee.object, context)) {
    factorArgumentIndex = 2;
  } else if (
    methodName &&
    hasInterpolationReceiverProvenance(node.callee.object, callback, managedRefSymbolIds, context)
  ) {
    factorArgumentIndex = INTERPOLATION_FACTOR_ARGUMENT_BY_METHOD.get(methodName);
  }
  if (factorArgumentIndex === undefined) return null;
  const factor = node.arguments[factorArgumentIndex];
  if (!factor || isNodeOfType(factor, "SpreadElement")) return null;
  const staticFactor = resolveStaticNumber(factor, context);
  return staticFactor !== null && staticFactor > 0 && staticFactor < 1 ? factor : null;
};

const getRotationOwner = (expression: EsTreeNode): EsTreeNode | null => {
  const axisMember = stripParenExpression(expression);
  if (
    !isNodeOfType(axisMember, "MemberExpression") ||
    !["x", "y", "z"].includes(getStaticPropertyName(axisMember) ?? "")
  ) {
    return null;
  }
  const rotationMember = stripParenExpression(axisMember.object);
  if (
    !isNodeOfType(rotationMember, "MemberExpression") ||
    getStaticPropertyName(rotationMember) !== "rotation"
  ) {
    return null;
  }
  return stripParenExpression(rotationMember.object);
};

const areSameResolvedReceivers = (
  left: EsTreeNode,
  right: EsTreeNode,
  context: RuleContext,
): boolean => {
  const leftReceiver = stripParenExpression(left);
  const rightReceiver = stripParenExpression(right);
  if (isNodeOfType(leftReceiver, "ThisExpression")) {
    return isNodeOfType(rightReceiver, "ThisExpression");
  }
  if (isNodeOfType(leftReceiver, "Identifier")) {
    if (!isNodeOfType(rightReceiver, "Identifier")) return false;
    const leftSymbol = context.scopes.symbolFor(leftReceiver);
    const rightSymbol = context.scopes.symbolFor(rightReceiver);
    return Boolean(leftSymbol && rightSymbol && leftSymbol.id === rightSymbol.id);
  }
  if (
    !isNodeOfType(leftReceiver, "MemberExpression") ||
    !isNodeOfType(rightReceiver, "MemberExpression")
  ) {
    return false;
  }
  const leftPropertyName = getStaticPropertyName(leftReceiver);
  return (
    leftPropertyName !== null &&
    leftPropertyName === getStaticPropertyName(rightReceiver) &&
    areSameResolvedReceivers(leftReceiver.object, rightReceiver.object, context)
  );
};

const isRotationCorrectionAfterLookAt = (
  node: EsTreeNodeOfType<"AssignmentExpression">,
  context: RuleContext,
): boolean => {
  const rotationOwner = getRotationOwner(node.left);
  if (!rotationOwner) return false;
  const assignmentRoot = findTransparentExpressionRoot(node);
  const assignmentStatement = assignmentRoot.parent;
  if (
    !isNodeOfType(assignmentStatement, "ExpressionStatement") ||
    assignmentStatement.expression !== assignmentRoot ||
    !isNodeOfType(assignmentStatement.parent, "BlockStatement")
  ) {
    return false;
  }
  const statementIndex = assignmentStatement.parent.body.findIndex(
    (statement) => statement.range[0] === assignmentStatement.range[0],
  );
  const previousStatement = assignmentStatement.parent.body[statementIndex - 1];
  if (!isNodeOfType(previousStatement, "ExpressionStatement")) return false;
  const previousExpression = stripParenExpression(previousStatement.expression);
  if (
    !isNodeOfType(previousExpression, "CallExpression") ||
    !isNodeOfType(previousExpression.callee, "MemberExpression") ||
    getStaticPropertyName(previousExpression.callee) !== "lookAt"
  ) {
    return false;
  }
  return areSameResolvedReceivers(rotationOwner, previousExpression.callee.object, context);
};

export const r3fRequireFrameDelta = defineRule({
  id: "r3f-require-frame-delta",
  title: "Frame-rate-dependent animation",
  category: "Correctness",
  severity: "warn",
  recommendation:
    "Scale incremental transforms and interpolation by useFrame delta, use delta-aware damping, or assign from absolute time",
  create: (context: RuleContext) => {
    let managedRefSymbolIds: ReadonlySet<number> = new Set();
    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        managedRefSymbolIds = collectR3fHostRefSymbolIds(node, context.scopes);
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        const callback = resolveR3fCallback(node, "useFrame", context.scopes);
        if (!isFunctionLike(callback)) return;
        walkFunctionExecution(callback, context.scopes, (candidate, isConditionallyExecuted) => {
          const isBehindReactRefAvailabilityGuard =
            isConditionallyExecuted &&
            isConditionallyExecutedOnlyByReactRefAvailability(candidate, callback, context);
          if (
            isNodeOfType(candidate, "UpdateExpression") &&
            isTransformMember(candidate.argument, callback, managedRefSymbolIds, context) &&
            (!isConditionallyExecuted || isBehindReactRefAvailabilityGuard)
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
              !isTransformMember(candidate.left, callback, managedRefSymbolIds, context) ||
              expressionReferencesDelta(candidate.right, callback, context) ||
              isRotationCorrectionAfterLookAt(candidate, context) ||
              (isConditionallyExecuted && !isBehindReactRefAvailabilityGuard)
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
          const factor = getFixedInterpolationFactor(
            candidate,
            callback,
            managedRefSymbolIds,
            context,
          );
          if (
            !factor ||
            expressionReferencesDelta(factor, callback, context) ||
            (isConditionallyExecuted && !isBehindReactRefAvailabilityGuard)
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
    };
  },
});
