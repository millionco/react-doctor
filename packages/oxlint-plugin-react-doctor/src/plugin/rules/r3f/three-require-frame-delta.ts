import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import {
  THREE_INTERPOLATION_FACTOR_ARGUMENT_BY_METHOD,
  THREE_MATH_UTILS_LERP_FACTOR_ARGUMENT_INDEX,
} from "./constants.js";
import { getApiReferenceModuleSource } from "./utils/get-api-reference-module-source.js";
import { getThreeConstructorName } from "./utils/get-three-constructor-name.js";
import { hasThreeObjectProvenance } from "./utils/has-three-object-provenance.js";
import { resolveStaticNumber } from "./utils/resolve-static-number.js";
import { resolveThreeAnimationLoopCallback } from "./utils/resolve-three-animation-loop-callback.js";
import { walkFunctionExecution } from "./utils/walk-function-execution.js";

const TRANSFORM_PROPERTY_NAMES: ReadonlySet<string> = new Set([
  "position",
  "quaternion",
  "rotation",
  "scale",
]);

const isThreeTransformMember = (expression: EsTreeNode, context: RuleContext): boolean => {
  let candidate = stripParenExpression(expression);
  let hasTransformProperty = false;
  while (isNodeOfType(candidate, "MemberExpression")) {
    if (TRANSFORM_PROPERTY_NAMES.has(getStaticPropertyName(candidate) ?? "")) {
      hasTransformProperty = true;
    }
    candidate = stripParenExpression(candidate.object);
  }
  return hasTransformProperty && hasThreeObjectProvenance(expression, context.scopes);
};

const expressionUsesThreeClockDelta = (
  expression: EsTreeNode,
  context: RuleContext,
  visitedSymbolIds: Set<number> = new Set(),
): boolean => {
  let usesDelta = false;
  walkAst(expression, (candidate) => {
    if (
      isNodeOfType(candidate, "CallExpression") &&
      isNodeOfType(candidate.callee, "MemberExpression") &&
      getStaticPropertyName(candidate.callee) === "getDelta" &&
      getThreeConstructorName(candidate.callee.object, context.scopes) === "Clock"
    ) {
      usesDelta = true;
      return false;
    }
    if (!isNodeOfType(candidate, "Identifier")) return;
    const symbol = context.scopes.symbolFor(candidate);
    if (
      symbol?.kind !== "const" ||
      !symbol.initializer ||
      visitedSymbolIds.has(symbol.id) ||
      symbol.references.some((reference) => reference.flag !== "read")
    ) {
      return;
    }
    visitedSymbolIds.add(symbol.id);
    if (expressionUsesThreeClockDelta(symbol.initializer, context, visitedSymbolIds)) {
      usesDelta = true;
      return false;
    }
  });
  return usesDelta;
};

const getFixedInterpolationFactor = (
  node: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): EsTreeNode | null => {
  if (!isNodeOfType(node.callee, "MemberExpression")) return null;
  const methodName = getStaticPropertyName(node.callee);
  let factorArgumentIndex: number | undefined;
  if (
    methodName === "lerp" &&
    getApiReferenceModuleSource(node.callee.object, "MathUtils", context.scopes) === "three"
  ) {
    factorArgumentIndex = THREE_MATH_UTILS_LERP_FACTOR_ARGUMENT_INDEX;
  } else if (methodName && hasThreeObjectProvenance(node.callee.object, context.scopes)) {
    factorArgumentIndex = THREE_INTERPOLATION_FACTOR_ARGUMENT_BY_METHOD.get(methodName);
  }
  if (factorArgumentIndex === undefined) return null;
  const factor = node.arguments[factorArgumentIndex];
  if (!factor || isNodeOfType(factor, "SpreadElement")) return null;
  const staticFactor = resolveStaticNumber(factor, context.scopes);
  return staticFactor !== null && staticFactor > 0 && staticFactor < 1 ? factor : null;
};

export const threeRequireFrameDelta = defineRule({
  id: "three-require-frame-delta",
  title: "Frame-rate-dependent Three.js animation",
  category: "Correctness",
  severity: "warn",
  recommendation:
    "Scale incremental transforms and interpolation by Clock.getDelta(), use delta-aware damping, or assign from absolute animation time",
  create: (context: RuleContext) => {
    const analyzedCallbacks = new Set<EsTreeNode>();
    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        const callback = resolveThreeAnimationLoopCallback(node, context.scopes);
        if (!callback || analyzedCallbacks.has(callback)) return;
        analyzedCallbacks.add(callback);
        walkFunctionExecution(callback, context.scopes, (candidate, isConditionallyExecuted) => {
          if (isConditionallyExecuted) return;
          if (
            isNodeOfType(candidate, "UpdateExpression") &&
            isThreeTransformMember(candidate.argument, context)
          ) {
            context.report({
              node: candidate,
              message:
                "This transform changes by a fixed amount per frame, so animation speed depends on refresh rate. Use a Three.js Clock delta instead of an update operator",
            });
            return;
          }
          if (
            isNodeOfType(candidate, "AssignmentExpression") &&
            (candidate.operator === "+=" || candidate.operator === "-=") &&
            isThreeTransformMember(candidate.left, context) &&
            !expressionUsesThreeClockDelta(candidate.right, context)
          ) {
            context.report({
              node: candidate,
              message:
                "This transform changes by a fixed amount per frame, so animation speed depends on refresh rate. Multiply the increment by Clock.getDelta()",
            });
            return;
          }
          if (!isNodeOfType(candidate, "CallExpression")) return;
          const factor = getFixedInterpolationFactor(candidate, context);
          if (!factor || expressionUsesThreeClockDelta(factor, context)) return;
          context.report({
            node: factor,
            message:
              "This fixed interpolation factor converges once per frame, so its speed changes with refresh rate. Derive the factor from Clock.getDelta() or use delta-aware damping",
          });
        });
      },
    };
  },
});
