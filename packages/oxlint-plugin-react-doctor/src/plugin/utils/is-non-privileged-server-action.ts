import {
  CACHE_REVALIDATION_FUNCTION_NAMES,
  NEXTJS_NAVIGATION_FUNCTIONS,
} from "../constants/nextjs.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { walkAst } from "./walk-ast.js";

type FunctionLikeNode =
  | EsTreeNodeOfType<"FunctionDeclaration">
  | EsTreeNodeOfType<"FunctionExpression">
  | EsTreeNodeOfType<"ArrowFunctionExpression">;

// Calls that change neither protected data nor server state: Next.js cache
// invalidation (`revalidateTag`/`revalidatePath`/…) only busts the data
// cache, and navigation (`redirect`/`notFound`/…) only steers the response.
// An unauthenticated caller gains nothing by triggering either.
const NON_DATA_EFFECT_FUNCTION_NAMES: ReadonlySet<string> = new Set([
  ...CACHE_REVALIDATION_FUNCTION_NAMES,
  ...NEXTJS_NAVIGATION_FUNCTIONS,
]);

// Matched only as a BARE identifier callee. A member call (`obj.redirect()`,
// `db.revalidateTag()`) shares the name but not the import, and could touch
// data on an arbitrary receiver, so it must not satisfy the exemption.
const isCacheOrNavigationCall = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "CallExpression") &&
  isNodeOfType(node.callee, "Identifier") &&
  NON_DATA_EFFECT_FUNCTION_NAMES.has(node.callee.name);

// Any node that can reach state beyond the action's own locals: a non-cache/
// non-navigation call (DB query, `fetch`, cookie mutation, an imported
// helper), a tagged template (raw-SQL clients like `sql\`DELETE …\``), a
// constructor, or an assignment.
const isPrivilegedEffect = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "CallExpression") ||
  isNodeOfType(node, "TaggedTemplateExpression") ||
  isNodeOfType(node, "NewExpression") ||
  isNodeOfType(node, "AssignmentExpression") ||
  isNodeOfType(node, "UpdateExpression");

// A server action is "non-privileged" when nothing it does can read or mutate
// protected data: its body busts the cache and/or navigates, and contains no
// other effect. Such an action is safe to call unauthenticated, so the
// missing-auth-check rule must not flag it.
//
// The check is conservative: the body must contain at least one cache- or
// navigation call AND no other privileged effect. Anything else — a DB write,
// a `fetch`, an imported helper, a raw-SQL tagged template, a constructor —
// disqualifies the exemption, so a genuinely sensitive action is never
// silently allowed through.
export const isNonPrivilegedServerAction = (functionNode: FunctionLikeNode): boolean => {
  const functionBody = functionNode.body;
  if (!functionBody) return false;

  let hasNonDataEffectCall = false;
  let hasPrivilegedEffect = false;

  walkAst(functionBody, (child: EsTreeNode) => {
    if (hasPrivilegedEffect) return false;
    // Prune nested function bodies: a call inside a closure the action
    // never invokes shouldn't count for or against the exemption.
    if (child !== functionBody && isFunctionLike(child)) return false;

    // Keep descending after a cache/navigation call so a privileged effect
    // hidden in its arguments (`revalidateTag(db.get())`) is still caught.
    if (isCacheOrNavigationCall(child)) {
      hasNonDataEffectCall = true;
      return;
    }
    if (isPrivilegedEffect(child)) {
      hasPrivilegedEffect = true;
      return false;
    }
  });

  return hasNonDataEffectCall && !hasPrivilegedEffect;
};
