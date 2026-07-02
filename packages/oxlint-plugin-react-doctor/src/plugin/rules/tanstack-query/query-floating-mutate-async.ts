import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getCalleeName } from "../../utils/get-callee-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";

// Callback hosts that discard their callback's return value, so a concise
// `() => x.mutateAsync()` body there is a fire-and-forget floating call —
// exactly where an unhandled rejection is most acute (effects + timers).
const FLOATING_CALLBACK_HOST_NAMES = new Set([
  "useEffect",
  "useLayoutEffect",
  "useInsertionEffect",
  "setTimeout",
  "setInterval",
  "setImmediate",
  "requestAnimationFrame",
  "requestIdleCallback",
  "queueMicrotask",
]);

// Wrappers that forward the promise unchanged while walking up from the
// call: optional-chain containers, parens, and TS assertion nodes (oxc's
// ESTree surfaces parens as `ParenthesizedExpression`, which is not part
// of the TSESTree union — hence the string set, mirroring
// `stripParenExpression`).
const TRANSPARENT_PROMISE_WRAPPER_TYPES = new Set<string>([
  "ChainExpression",
  "ParenthesizedExpression",
  "TSAsExpression",
  "TSSatisfiesExpression",
  "TSNonNullExpression",
]);

const isMutateAsyncMemberCall = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "CallExpression") &&
  isNodeOfType(node.callee, "MemberExpression") &&
  !node.callee.computed &&
  isNodeOfType(node.callee.property, "Identifier") &&
  node.callee.property.name === "mutateAsync";

// `const { mutateAsync } = useMutation(...)` followed by a bare
// `mutateAsync(payload)` — the callee is a plain Identifier, so we
// scope-resolve it back to its declarator and require the destructure
// source to be a `useMutation(...)` call (wrapper hooks that may catch
// internally stay unflagged).
const isDestructuredMutateAsyncCall = (node: EsTreeNode, context: RuleContext): boolean => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  if (!isNodeOfType(node.callee, "Identifier") || node.callee.name !== "mutateAsync") return false;
  const symbol = context.scopes.symbolFor(node.callee);
  if (!symbol || !isNodeOfType(symbol.declarationNode, "VariableDeclarator")) return false;
  return symbol.initializer !== null && getCalleeName(symbol.initializer) === "useMutation";
};

// A concise `() => x.mutateAsync()` returns the promise to its caller, so
// it's only floating when that return value is thrown away: a bare
// statement, a JSX event handler, or a discarding scheduler callback
// (useEffect/setTimeout/...). Passing the arrow into `Promise.all(items.map(...))`
// or returning it keeps the rejection reachable, so those stay quiet.
const isDiscardedArrowReturn = (arrow: EsTreeNode): boolean => {
  const parent = arrow.parent;
  if (!parent) return false;
  if (isNodeOfType(parent, "ExpressionStatement")) return true;
  if (isNodeOfType(parent, "JSXExpressionContainer")) return true;
  if (isNodeOfType(parent, "CallExpression")) {
    const isArgument = parent.arguments?.some((argument) => argument === arrow) ?? false;
    if (!isArgument) return false;
    const hostName = getCalleeName(parent);
    return hostName !== null && FLOATING_CALLBACK_HOST_NAMES.has(hostName);
  }
  return false;
};

// True when the mutateAsync call's promise is discarded with no rejection
// handler. Walks upward through wrappers that keep the promise floating —
// ChainExpression, ternary branches, `&&`/`||` right operands, and
// `.then(onFulfilled)` / `.finally(...)` steps that never handle rejection —
// then requires the outermost expression to be a bare ExpressionStatement or
// the concise body of a discarded-return arrow. A `.catch(...)`, two-argument
// `.then(...)`, await/return/void wrapper, assignment, or `Promise.all([...])`
// argument position stays quiet.
const isFloatingMutateAsync = (node: EsTreeNode): boolean => {
  let current: EsTreeNode = node;
  let parent: EsTreeNode | null = current.parent ?? null;
  while (parent) {
    if (TRANSPARENT_PROMISE_WRAPPER_TYPES.has(parent.type)) {
      current = parent;
      parent = current.parent ?? null;
      continue;
    }
    if (
      isNodeOfType(parent, "ConditionalExpression") &&
      (parent.consequent === current || parent.alternate === current)
    ) {
      current = parent;
      parent = current.parent ?? null;
      continue;
    }
    if (isNodeOfType(parent, "LogicalExpression") && parent.right === current) {
      current = parent;
      parent = current.parent ?? null;
      continue;
    }
    if (
      isNodeOfType(parent, "MemberExpression") &&
      parent.object === current &&
      !parent.computed &&
      isNodeOfType(parent.property, "Identifier")
    ) {
      const chainMethodName = parent.property.name;
      if (chainMethodName === "catch") return false;
      if (chainMethodName !== "then" && chainMethodName !== "finally") break;
      const chainStepCall: EsTreeNode | null = parent.parent ?? null;
      if (
        !chainStepCall ||
        !isNodeOfType(chainStepCall, "CallExpression") ||
        chainStepCall.callee !== parent
      ) {
        return false;
      }
      const thenHandlesRejection =
        chainMethodName === "then" && (chainStepCall.arguments?.length ?? 0) >= 2;
      if (thenHandlesRejection) return false;
      current = chainStepCall;
      parent = current.parent ?? null;
      continue;
    }
    break;
  }
  if (!parent) return false;
  if (isNodeOfType(parent, "ExpressionStatement")) return true;
  if (isNodeOfType(parent, "ArrowFunctionExpression") && parent.body === current) {
    return isDiscardedArrowReturn(parent);
  }
  return false;
};

export const queryFloatingMutateAsync = defineRule({
  id: "query-floating-mutate-async",
  title: "Floating mutateAsync rejection",
  requires: ["tanstack-query"],
  severity: "warn",
  recommendation:
    "Await, return, or `.catch()` the `mutateAsync()` promise so its rejection surfaces an error instead of becoming a silent unhandled rejection.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isMutateAsyncMemberCall(node) && !isDestructuredMutateAsyncCall(node, context)) return;
      if (!isFloatingMutateAsync(node)) return;
      context.report({
        node,
        message:
          "This `mutateAsync()` promise is never awaited or caught, so a failed mutation becomes a silent unhandled rejection — await, return, or `.catch()` it.",
      });
    },
  }),
});
