import type { Reference } from "eslint-scope";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getEffectCallback } from "../../../utils/get-effect-callback.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isResultDiscardedCall } from "../../../utils/is-result-discarded-call.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { getRef } from "./effect/ast.js";
import type { ProgramAnalysis } from "./effect/get-program-analysis.js";

export const isOnlyCalledInEffect = (
  reference: Reference,
  effectCall: EsTreeNodeOfType<"CallExpression">,
  analysis: ProgramAnalysis,
): boolean => {
  const callback = getEffectCallback(effectCall);
  if (!callback || !reference.resolved) return false;
  let hasCall = false;
  let hasValueRead = false;
  walkAst(callback, (node) => {
    if (hasValueRead) return false;
    if (
      !isNodeOfType(node, "Identifier") ||
      getRef(analysis, node)?.resolved !== reference.resolved
    )
      return;
    const expression = findTransparentExpressionRoot(node);
    const call = expression.parent;
    if (
      isNodeOfType(call, "CallExpression") &&
      call.callee === expression &&
      isResultDiscardedCall(call)
    )
      hasCall = true;
    else hasValueRead = true;
  });
  return hasCall && !hasValueRead;
};
