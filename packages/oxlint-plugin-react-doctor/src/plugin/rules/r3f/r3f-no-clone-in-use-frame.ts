import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveReactRefSymbol } from "../../utils/react-ref-origin.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { collectR3fHostRefSymbolIds } from "./utils/collect-r3f-host-ref-symbol-ids.js";
import { isR3fCallbackStateProperty } from "./utils/is-r3f-callback-state-property.js";
import { isR3fUseThreeStateProperty } from "./utils/is-r3f-use-three-state-property.js";
import { resolveR3fCallback } from "./utils/resolve-r3f-callback.js";
import { walkFunctionExecution } from "./utils/walk-function-execution.js";

const CLONEABLE_R3F_STATE_PROPERTIES = ["camera", "mouse", "pointer", "raycaster", "scene"];
const THREE_OBJECT_MEMBER_PROPERTIES = new Set([
  "color",
  "geometry",
  "material",
  "matrix",
  "matrixWorld",
  "position",
  "quaternion",
  "rotation",
  "scale",
]);

const hasThreeObjectProvenance = (
  expression: EsTreeNode,
  callback: EsTreeNode,
  managedRefSymbolIds: ReadonlySet<number>,
  context: RuleContext,
  visitedSymbolIds: Set<number> = new Set(),
): boolean => {
  const firstCallbackParameter = isFunctionLike(callback) ? callback.params[0] : null;
  const callbackParameter = isNodeOfType(firstCallbackParameter, "AssignmentPattern")
    ? firstCallbackParameter.left
    : firstCallbackParameter;
  let current = stripParenExpression(expression);
  let hasThreeObjectMember = false;
  while (isNodeOfType(current, "MemberExpression")) {
    if (THREE_OBJECT_MEMBER_PROPERTIES.has(getStaticPropertyName(current) ?? "")) {
      hasThreeObjectMember = true;
    }
    const refSymbol = resolveReactRefSymbol(current, context.scopes, {
      includeCreateRef: true,
      resolveNamedAliases: true,
    });
    if (
      (hasThreeObjectMember || getStaticPropertyName(current) === "current") &&
      refSymbol &&
      managedRefSymbolIds.has(refSymbol.id)
    ) {
      return true;
    }
    current = stripParenExpression(current.object);
  }
  if (
    isNodeOfType(current, "Identifier") &&
    isNodeOfType(callbackParameter, "Identifier") &&
    context.scopes.symbolFor(current)?.id === context.scopes.symbolFor(callbackParameter)?.id
  ) {
    return true;
  }
  if (
    CLONEABLE_R3F_STATE_PROPERTIES.some((propertyName) =>
      isR3fCallbackStateProperty(current, callback, propertyName, context.scopes),
    )
  ) {
    return true;
  }
  if (
    CLONEABLE_R3F_STATE_PROPERTIES.some((propertyName) =>
      isR3fUseThreeStateProperty(current, propertyName, context),
    )
  ) {
    return true;
  }
  if (!isNodeOfType(current, "Identifier")) return false;
  const symbol = context.scopes.symbolFor(current);
  if (
    symbol?.kind !== "const" ||
    !symbol.initializer ||
    visitedSymbolIds.has(symbol.id) ||
    symbol.references.some((reference) => reference.flag !== "read")
  ) {
    return false;
  }
  visitedSymbolIds.add(symbol.id);
  return hasThreeObjectProvenance(
    symbol.initializer,
    callback,
    managedRefSymbolIds,
    context,
    visitedSymbolIds,
  );
};

export const r3fNoCloneInUseFrame = defineRule({
  id: "r3f-no-clone-in-use-frame",
  title: "Three.js clone inside useFrame",
  severity: "warn",
  recommendation:
    "Clone once outside the frame loop or reuse a scratch vector, quaternion, matrix, or object allocated with useMemo or useRef",
  create: (context: RuleContext) => {
    let managedRefSymbolIds: ReadonlySet<number> = new Set();
    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        managedRefSymbolIds = collectR3fHostRefSymbolIds(node, context.scopes);
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        const callback = resolveR3fCallback(node, "useFrame", context.scopes);
        if (!callback) return;
        walkFunctionExecution(callback, context.scopes, (candidate, isConditionallyExecuted) => {
          if (
            isConditionallyExecuted ||
            !isNodeOfType(candidate, "CallExpression") ||
            !isNodeOfType(candidate.callee, "MemberExpression") ||
            getStaticPropertyName(candidate.callee) !== "clone" ||
            !hasThreeObjectProvenance(
              candidate.callee.object,
              callback,
              managedRefSymbolIds,
              context,
            )
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
    };
  },
});
