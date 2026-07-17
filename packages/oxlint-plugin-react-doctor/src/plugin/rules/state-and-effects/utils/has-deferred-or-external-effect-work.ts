import { TIMER_AND_SCHEDULER_DIRECT_CALLEE_NAMES } from "../../../constants/dom.js";
import { FETCH_CALLEE_NAMES } from "../../../constants/library.js";
import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { resolveExactLocalFunction } from "../../../utils/resolve-exact-local-function.js";
import { walkAst } from "../../../utils/walk-ast.js";
import type { ProgramAnalysis } from "./effect/get-program-analysis.js";
import { getEffectFn } from "./effect/react.js";

const DEFERRED_MEMBER_NAMES: ReadonlySet<string> = new Set(["catch", "finally", "then"]);

export const hasDeferredOrExternalEffectWork = (
  analysis: ProgramAnalysis,
  effectNode: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const effectFunction = getEffectFn(analysis, effectNode);
  if (!effectFunction) return false;
  let didFindDeferredOrExternalWork = false;
  walkAst(effectFunction, (child) => {
    if (didFindDeferredOrExternalWork) return false;
    if (isNodeOfType(child, "AssignmentExpression")) {
      const assignmentTarget = child.left;
      const handlerName = isNodeOfType(assignmentTarget, "MemberExpression")
        ? getStaticPropertyName(assignmentTarget)
        : null;
      if (handlerName?.startsWith("on") && isFunctionLike(child.right)) {
        didFindDeferredOrExternalWork = true;
        return false;
      }
    }
    if (!isNodeOfType(child, "CallExpression")) return;
    const localFunction = resolveExactLocalFunction(child.callee, scopes);
    if (isFunctionLike(localFunction) && localFunction.async) {
      didFindDeferredOrExternalWork = true;
      return false;
    }
    const callee = child.callee;
    if (
      isNodeOfType(callee, "Identifier") &&
      (FETCH_CALLEE_NAMES.has(callee.name) ||
        TIMER_AND_SCHEDULER_DIRECT_CALLEE_NAMES.has(callee.name))
    ) {
      didFindDeferredOrExternalWork = true;
      return false;
    }
    const memberName = isNodeOfType(callee, "MemberExpression")
      ? getStaticPropertyName(callee)
      : null;
    if (memberName && DEFERRED_MEMBER_NAMES.has(memberName)) {
      didFindDeferredOrExternalWork = true;
      return false;
    }
  });
  return didFindDeferredOrExternalWork;
};
