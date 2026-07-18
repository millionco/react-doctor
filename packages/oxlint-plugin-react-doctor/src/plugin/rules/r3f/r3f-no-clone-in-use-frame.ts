import { defineRule } from "../../utils/define-rule.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveReactRefSymbol } from "../../utils/react-ref-origin.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { isR3fCallbackStateProperty } from "./utils/is-r3f-callback-state-property.js";
import { resolveR3fCallback } from "./utils/resolve-r3f-callback.js";
import { walkFunctionExecution } from "./utils/walk-function-execution.js";

const CLONEABLE_R3F_STATE_PROPERTIES = ["camera", "mouse", "pointer", "raycaster", "scene"];

const hasThreeObjectProvenance = (
  expression: EsTreeNode,
  callback: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number> = new Set(),
): boolean => {
  const firstCallbackParameter = isFunctionLike(callback) ? callback.params[0] : null;
  const callbackParameter = isNodeOfType(firstCallbackParameter, "AssignmentPattern")
    ? firstCallbackParameter.left
    : firstCallbackParameter;
  let current = stripParenExpression(expression);
  while (isNodeOfType(current, "MemberExpression")) {
    if (resolveReactRefSymbol(current, scopes)) return true;
    current = stripParenExpression(current.object);
  }
  if (
    isNodeOfType(current, "Identifier") &&
    isNodeOfType(callbackParameter, "Identifier") &&
    scopes.symbolFor(current)?.id === scopes.symbolFor(callbackParameter)?.id
  ) {
    return true;
  }
  if (
    CLONEABLE_R3F_STATE_PROPERTIES.some((propertyName) =>
      isR3fCallbackStateProperty(current, callback, propertyName, scopes),
    )
  ) {
    return true;
  }
  if (!isNodeOfType(current, "Identifier")) return false;
  const symbol = scopes.symbolFor(current);
  if (
    symbol?.kind !== "const" ||
    !symbol.initializer ||
    visitedSymbolIds.has(symbol.id) ||
    symbol.references.some((reference) => reference.flag !== "read")
  ) {
    return false;
  }
  visitedSymbolIds.add(symbol.id);
  return hasThreeObjectProvenance(symbol.initializer, callback, scopes, visitedSymbolIds);
};

export const r3fNoCloneInUseFrame = defineRule({
  id: "r3f-no-clone-in-use-frame",
  title: "Three.js clone inside useFrame",
  severity: "warn",
  recommendation:
    "Clone once outside the frame loop or reuse a scratch vector, quaternion, matrix, or object allocated with useMemo or useRef",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      const callback = resolveR3fCallback(node, "useFrame", context.scopes);
      if (!callback) return;
      walkFunctionExecution(callback, context.scopes, (candidate) => {
        if (
          !isNodeOfType(candidate, "CallExpression") ||
          !isNodeOfType(candidate.callee, "MemberExpression") ||
          getStaticPropertyName(candidate.callee) !== "clone" ||
          !hasThreeObjectProvenance(candidate.callee.object, callback, context.scopes)
        ) {
          return;
        }
        context.report({
          node: candidate,
          message:
            "This clone allocates a new Three.js object every executed frame. Reuse a scratch object or clone once outside useFrame",
        });
      });
    },
  }),
});
