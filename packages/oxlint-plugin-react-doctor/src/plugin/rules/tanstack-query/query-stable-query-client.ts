import { STABLE_HOOK_WRAPPERS, UPPERCASE_PATTERN } from "../../constants/react.js";
import { TANSTACK_QUERY_CLIENT_CLASS } from "../../constants/tanstack.js";
import { defineRule } from "../../utils/define-rule.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { getFunctionBindingName } from "../../utils/get-function-binding-name.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isImmediatelyInvokedFunction } from "../../utils/is-immediately-invoked-function.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// A render function whose body runs on every render: a component (uppercase
// name via declaration / variable / assignment). A nested closure inside it —
// an event handler (`const onClick = () => …`) or a `useState(() => …)`
// initializer — runs LATER / once, not per render, so a `new QueryClient()`
// there is stable and must not be flagged.
const isComponentFunction = (functionNode: EsTreeNode): boolean => {
  const name = getFunctionBindingName(functionNode);
  return name ? UPPERCASE_PATTERN.test(name) : false;
};

// `useState(new QueryClient())` / `useRef(new QueryClient())` retain the
// FIRST value — the client identity stays stable across renders, so the
// direct-argument position is exempt even though the constructor re-runs.
const isStableHookWrapperArgument = (node: EsTreeNode): boolean => {
  const parent = node.parent;
  return (
    isNodeOfType(parent, "CallExpression") &&
    isNodeOfType(parent.callee, "Identifier") &&
    STABLE_HOOK_WRAPPERS.has(parent.callee.name) &&
    Boolean(parent.arguments?.some((argument: EsTreeNode) => argument === node))
  );
};

// An immediately-invoked function runs synchronously in whatever scope
// encloses it, so it is transparent when deciding whether a construction
// happens per render: `const client = (() => new QueryClient())()` in a
// component body still constructs on every render.
export const queryStableQueryClient = defineRule({
  id: "query-stable-query-client",
  title: "Unstable QueryClient in component",
  tags: ["test-noise"],
  requires: ["tanstack-query"],
  severity: "warn",
  recommendation:
    "Move `new QueryClient()` to module scope, or wrap it in `useState(() => new QueryClient())`. Recreating it each render wipes the cache.",
  create: (context: RuleContext) => ({
    NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
      if (
        !isNodeOfType(node.callee, "Identifier") ||
        node.callee.name !== TANSTACK_QUERY_CLIENT_CLASS
      )
        return;

      if (isStableHookWrapperArgument(node)) return;

      // Only fire when the nearest enclosing function is the component itself
      // — i.e. the construction runs in the render body. A nested closure
      // (event handler, stable-hook initializer) defers it, so it's stable;
      // an IIFE executes inline, so keep climbing through it.
      let enclosingFunction = findEnclosingFunction(node);
      while (enclosingFunction && isImmediatelyInvokedFunction(enclosingFunction)) {
        enclosingFunction = findEnclosingFunction(enclosingFunction);
      }
      if (!enclosingFunction) return;
      if (!isComponentFunction(enclosingFunction)) return;
      context.report({
        node,
        message: "new QueryClient() inside a component wipes your cache on every render.",
      });
    },
  }),
});
