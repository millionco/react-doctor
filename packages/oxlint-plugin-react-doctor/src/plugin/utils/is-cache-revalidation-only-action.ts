import { CACHE_REVALIDATION_FUNCTION_NAMES } from "../constants/nextjs.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getCalleeName } from "./get-callee-name.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { walkAst } from "./walk-ast.js";

// A server action whose body does nothing but bust the Next.js cache
// (`revalidateTag` / `revalidatePath` / `expireTag` / …) is not a
// privileged operation: it reads no data and mutates no records, so an
// unauthenticated caller can gain nothing by invoking it. Such actions
// must not be flagged by the missing-auth-check rule.
//
// "Only" is enforced conservatively: the body must contain at least one
// revalidation call and NO other call expression. Any other invocation
// (a DB write, a fetch, an imported helper, even a `formData.get()`)
// disqualifies the exemption, so a genuinely sensitive action is never
// silently allowed through.
export const isCacheRevalidationOnlyAction = (functionBody: EsTreeNode | null): boolean => {
  if (!functionBody) return false;

  let revalidationCallCount = 0;
  let hasDisqualifyingCall = false;

  walkAst(functionBody, (child: EsTreeNode) => {
    if (hasDisqualifyingCall) return false;
    // Prune nested function bodies: a call inside a closure the action
    // never invokes shouldn't count for or against the exemption.
    if (child !== functionBody && isFunctionLike(child)) return false;
    if (!isNodeOfType(child, "CallExpression")) return;

    const calleeName = getCalleeName(child);
    if (calleeName && CACHE_REVALIDATION_FUNCTION_NAMES.has(calleeName)) {
      revalidationCallCount += 1;
      return;
    }
    hasDisqualifyingCall = true;
    return false;
  });

  return revalidationCallCount > 0 && !hasDisqualifyingCall;
};
