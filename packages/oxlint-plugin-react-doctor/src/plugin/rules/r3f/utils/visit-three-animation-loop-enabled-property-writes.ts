import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { getThreeConstructorName } from "./get-three-constructor-name.js";
import { resolveThreeAnimationLoopCallback } from "./resolve-three-animation-loop-callback.js";
import { walkFunctionExecution } from "./walk-function-execution.js";

export interface ThreeAnimationLoopEnabledPropertyWrite {
  readonly constructorName: string;
  readonly node: EsTreeNodeOfType<"AssignmentExpression">;
  readonly propertyName: string;
}

export const visitThreeAnimationLoopEnabledPropertyWrites = (
  call: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
  propertyNames: ReadonlySet<string>,
  analyzedCallbacks: Set<EsTreeNode>,
  visitor: (write: ThreeAnimationLoopEnabledPropertyWrite) => void,
): void => {
  const callback = resolveThreeAnimationLoopCallback(call, scopes);
  if (!callback || analyzedCallbacks.has(callback)) return;
  analyzedCallbacks.add(callback);
  walkFunctionExecution(callback, scopes, (candidate, isConditionallyExecuted) => {
    if (
      isConditionallyExecuted ||
      !isNodeOfType(candidate, "AssignmentExpression") ||
      candidate.operator !== "=" ||
      !isNodeOfType(candidate.left, "MemberExpression") ||
      !isNodeOfType(candidate.right, "Literal") ||
      candidate.right.value !== true
    ) {
      return;
    }
    const propertyName = getStaticPropertyName(candidate.left);
    if (!propertyName || !propertyNames.has(propertyName)) return;
    const constructorName = getThreeConstructorName(candidate.left.object, scopes);
    if (!constructorName) return;
    visitor({ constructorName, node: candidate, propertyName });
  });
};
