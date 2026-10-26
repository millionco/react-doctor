import { EFFECT_HOOK_NAMES } from "../../../constants/react.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isProvenUnmodifiedReactApiCall } from "../../../utils/is-proven-unmodified-react-api-call.js";

export const isReactHookDependencyRead = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  apiNames: ReadonlySet<string> = EFFECT_HOOK_NAMES,
): boolean => {
  const dependencyArray = expression.parent;
  if (
    !isNodeOfType(dependencyArray, "ArrayExpression") ||
    !dependencyArray.elements.some((element) => element === expression)
  )
    return false;
  const arrayExpression = findTransparentExpressionRoot(dependencyArray);
  const call = arrayExpression.parent;
  if (!isNodeOfType(call, "CallExpression") || call.optional) return false;
  const [callback, dependencies, ...extraArguments] = call.arguments;
  return Boolean(
    callback &&
    !isNodeOfType(callback, "SpreadElement") &&
    dependencies === arrayExpression &&
    !extraArguments.length &&
    isProvenUnmodifiedReactApiCall(call, apiNames, scopes),
  );
};
