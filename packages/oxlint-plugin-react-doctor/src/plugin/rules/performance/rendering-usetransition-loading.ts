import { LOADING_STATE_PATTERN } from "../../constants/react.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { walkAst } from "../../utils/walk-ast.js";

// Walks up to find the function-like that owns this VariableDeclarator
// (component body / hook body). `useTransition` is only an alternative
// to `useState(false)` when the loading flag guards a SYNC state
// transition. If the SETTER for this state is called from an async
// context (an `async` function body, or one that itself contains an
// `await`), the flag tracks async work and the rule's recommendation
// doesn't apply.
const enclosingFunctionBody = (node: EsTreeNode): EsTreeNode | null => {
  let cursor: EsTreeNode | null | undefined = node.parent;
  while (cursor) {
    if (
      isNodeOfType(cursor, "FunctionDeclaration") ||
      isNodeOfType(cursor, "FunctionExpression") ||
      isNodeOfType(cursor, "ArrowFunctionExpression")
    ) {
      return (cursor as { body: EsTreeNode | null }).body ?? null;
    }
    cursor = cursor.parent ?? null;
  }
  return null;
};

const hasOwnAwait = (functionBody: EsTreeNode | null): boolean => {
  if (!functionBody) return false;
  let found = false;
  walkAst(functionBody, (child: EsTreeNode) => {
    if (found) return;
    if (child !== functionBody && isFunctionLike(child)) {
      // Don't descend into nested functions — their awaits belong to
      // THEIR async context, not this one.
      return false;
    }
    if (isNodeOfType(child, "AwaitExpression")) found = true;
  });
  return found;
};

const callsIdentifier = (root: EsTreeNode | null, identifierName: string): boolean => {
  if (!root) return false;
  let found = false;
  walkAst(root, (child: EsTreeNode) => {
    if (found) return;
    if (
      isNodeOfType(child, "CallExpression") &&
      isNodeOfType(child.callee, "Identifier") &&
      child.callee.name === identifierName
    ) {
      found = true;
    }
  });
  return found;
};

const PROMISE_CHAIN_METHOD_NAMES: ReadonlySet<string> = new Set(["then", "catch", "finally"]);

// Identifiers that, when present alongside a loading useState, strongly
// signal async data fetching (not a transition). The rule's
// recommendation to use `useTransition` only applies to UI-state-only
// flips; an Apollo / TanStack / SWR / fetch hook caller is doing real
// I/O that React can't optimize away.
const ASYNC_DATA_CALLEE_NAMES: ReadonlySet<string> = new Set([
  "useApolloClient",
  "useMutation",
  "useQuery",
  "useLazyQuery",
  "useSubscription",
  "useSWR",
  "useSWRMutation",
  "useSWRInfinite",
  "fetch",
  "axios",
]);

// One pass over the component body computes every async-work signal the
// caller ORs together, short-circuiting on the first hit:
//   - `setterName` called inside an async-context function ("async" or an
//     own-scope `await`) — a sync helper toggling the flag doesn't count.
//   - `setterName` called inside a Promise-chain callback
//     (`loadData().then(() => setIsLoading(false))`).
//   - a call to a known async-data hook / global anywhere in the body.
const hasAsyncLoadingWork = (fnBody: EsTreeNode, setterName: string | null): boolean => {
  let found = false;
  walkAst(fnBody, (child: EsTreeNode) => {
    if (found) return false;
    if (isNodeOfType(child, "CallExpression")) {
      const callee = child.callee;
      if (isNodeOfType(callee, "Identifier") && ASYNC_DATA_CALLEE_NAMES.has(callee.name)) {
        found = true;
        return false;
      }
      if (isNodeOfType(callee, "MemberExpression") && isNodeOfType(callee.property, "Identifier")) {
        if (ASYNC_DATA_CALLEE_NAMES.has(callee.property.name)) {
          found = true;
          return false;
        }
        if (setterName !== null && PROMISE_CHAIN_METHOD_NAMES.has(callee.property.name)) {
          for (const argument of child.arguments ?? []) {
            if (!isFunctionLike(argument)) continue;
            if (callsIdentifier(argument.body, setterName)) {
              found = true;
              return false;
            }
          }
        }
      }
      return;
    }
    if (setterName !== null && isFunctionLike(child)) {
      const functionBody = (child as { body: EsTreeNode | null }).body;
      const isAsyncContext =
        Boolean((child as { async?: boolean }).async) || hasOwnAwait(functionBody);
      if (isAsyncContext && callsIdentifier(functionBody, setterName)) {
        found = true;
        return false;
      }
    }
  });
  return found;
};

export const renderingUsetransitionLoading = defineRule({
  id: "rendering-usetransition-loading",
  title: "Loading useState forces extra render",
  tags: ["test-noise"],
  severity: "warn",
  recommendation:
    "Replace with `const [isPending, startTransition] = useTransition()`, which skips the extra render for the loading flag",
  create: (context: RuleContext) => ({
    VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
      if (!isNodeOfType(node.id, "ArrayPattern") || !node.id.elements?.length) return;
      if (!node.init || !isHookCall(node.init, "useState")) return;
      if (!isNodeOfType(node.init, "CallExpression")) return;
      if (!node.init.arguments?.length) return;

      const initializer = node.init.arguments[0];
      if (!isNodeOfType(initializer, "Literal") || initializer.value !== false) return;

      const firstBinding = node.id.elements[0];
      const stateVariableName = isNodeOfType(firstBinding, "Identifier") ? firstBinding.name : null;
      if (!stateVariableName || !LOADING_STATE_PATTERN.test(stateVariableName)) return;

      const secondBinding = node.id.elements[1];
      const setterName = isNodeOfType(secondBinding, "Identifier") ? secondBinding.name : null;

      // Async-work loading states aren't transition candidates — there's
      // a real I/O suspension that React can't elide. Detect either the
      // SETTER being called inside an async-context function (so the
      // flag is wrapping that async work) OR a call to a known
      // async-data hook / global in the component body.
      const fnBody = enclosingFunctionBody(node as EsTreeNode);
      if (fnBody && hasAsyncLoadingWork(fnBody, setterName)) return;

      context.report({
        node: node.init,
        message: `This adds an extra render because useState for "${stateVariableName}" re-renders just for the loading flag, so if it's a state change & not a data fetch, use useTransition instead`,
      });
    },
  }),
});
