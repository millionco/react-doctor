import {
  CACHE_REVALIDATION_FUNCTION_NAMES,
  NEXTJS_NAVIGATION_FUNCTIONS,
} from "../constants/nextjs.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getCalleeName } from "./get-callee-name.js";
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

const collectParameterIdentifierNames = (functionNode: FunctionLikeNode): Set<string> => {
  const parameterNames = new Set<string>();
  for (const parameter of functionNode.params ?? []) {
    let target: EsTreeNode | null | undefined = parameter;
    while (target) {
      if (isNodeOfType(target, "AssignmentPattern")) {
        target = target.left;
        continue;
      }
      if (isNodeOfType(target, "RestElement")) {
        target = target.argument;
        continue;
      }
      if (isNodeOfType(target, "TSParameterProperty")) {
        target = target.parameter;
        continue;
      }
      break;
    }
    if (target && isNodeOfType(target, "Identifier")) parameterNames.add(target.name);
  }
  return parameterNames;
};

const getReceiverRootName = (node: EsTreeNode | null | undefined): string | null => {
  let current: EsTreeNode | null | undefined = node;
  while (current) {
    if (isNodeOfType(current, "Identifier")) return current.name;
    if (isNodeOfType(current, "MemberExpression")) {
      current = current.object;
      continue;
    }
    if (isNodeOfType(current, "ChainExpression")) {
      current = current.expression;
      continue;
    }
    if (isNodeOfType(current, "AwaitExpression")) {
      current = current.argument;
      continue;
    }
    if (isNodeOfType(current, "TSNonNullExpression") || isNodeOfType(current, "TSAsExpression")) {
      current = current.expression;
      continue;
    }
    return null;
  }
  return null;
};

// A server action is "non-privileged" when nothing it does can read or
// mutate protected data: its body busts the cache and/or navigates, and
// every other call only reads the action's own client-supplied arguments
// (e.g. `formData.get("tag")`). Such an action is safe to call
// unauthenticated, so the missing-auth-check rule must not flag it.
//
// The check is conservative: the body must contain at least one cache- or
// navigation call AND no call that could touch external state. Any other
// invocation — a DB write, a `fetch`, an imported helper, a cookie mutation
// — disqualifies the exemption, so a genuinely sensitive action is never
// silently allowed through.
export const isNonPrivilegedServerAction = (functionNode: FunctionLikeNode): boolean => {
  const functionBody = functionNode.body;
  if (!functionBody) return false;

  const parameterNames = collectParameterIdentifierNames(functionNode);

  let nonDataEffectCallCount = 0;
  let hasPrivilegedCall = false;

  walkAst(functionBody, (child: EsTreeNode) => {
    if (hasPrivilegedCall) return false;
    // Prune nested function bodies: a call inside a closure the action
    // never invokes shouldn't count for or against the exemption.
    if (child !== functionBody && isFunctionLike(child)) return false;
    if (!isNodeOfType(child, "CallExpression")) return;

    const calleeName = getCalleeName(child);
    if (calleeName && NON_DATA_EFFECT_FUNCTION_NAMES.has(calleeName)) {
      nonDataEffectCallCount += 1;
      return;
    }

    // A method call rooted at one of the action's own parameters reads
    // client-supplied input (`formData.get(...)`), never protected server
    // state — server-action arguments can't be a DB handle or auth client.
    if (isNodeOfType(child.callee, "MemberExpression")) {
      const receiverRootName = getReceiverRootName(child.callee.object);
      if (receiverRootName && parameterNames.has(receiverRootName)) return;
    }

    hasPrivilegedCall = true;
    return false;
  });

  return nonDataEffectCallCount > 0 && !hasPrivilegedCall;
};
