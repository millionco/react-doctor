import { MEMOIZING_HOOK_NAMES } from "../../constants/react.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { closureCaptures } from "../../semantic/closure-captures.js";

// The closure passed to `useMemo`/`useCallback` captures a reassignable
// binding from the surrounding render that is REASSIGNED after the hook is
// created. Because a JS closure closes over the variable, not the value, the
// memoised value/function observes the post-render mutation — a stale-value
// bug, since the deps array signals the author intended the binding's value
// at creation time. Verified with SSA: a write of the captured binding must
// be reachable from the hook call and reach the render's exit
// (`ssa.isRedefinedBetween`). Defers for `const` and for bindings that are
// never reassigned (no write in range → no report).
//
// Deliberately excludes the deferred effect hooks (`useEffect` /
// `useLayoutEffect`): their callbacks run AFTER the synchronous render
// completes, so reading the FINAL value of a render `let` assigned later in
// the body is the intended pattern (`let bounds; useEffect(() => use(bounds));
// bounds = compute()`), not a stale capture.
const lastStatementOf = (functionNode: EsTreeNode): EsTreeNode | null => {
  if (!isFunctionLike(functionNode)) return null;
  const body = functionNode.body as EsTreeNode;
  if (!isNodeOfType(body, "BlockStatement")) return null;
  const statements = body.body;
  return (statements[statements.length - 1] as EsTreeNode | undefined) ?? null;
};

export const noStaleClosureCapture = defineRule({
  id: "no-stale-closure-capture",
  title: "Closure captures a value reassigned later in render",
  severity: "warn",
  recommendation:
    "Don't reassign a variable after a hook closure captures it, because the closure runs later and sees the mutated value, not the one at creation. Compute the value before the hook, or pass it through the dependency array or a ref.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isHookCall(node, MEMOIZING_HOOK_NAMES)) return;
      const closure = node.arguments[0] as EsTreeNode | undefined;
      if (!closure || !isFunctionLike(closure)) return;

      const renderFunction = context.cfg.enclosingFunction(node);
      if (!renderFunction) return;
      const renderExit = lastStatementOf(renderFunction);
      if (!renderExit) return;

      const reportedBindings = new Set<number>();
      for (const reference of closureCaptures(closure, context.scopes)) {
        const symbol = reference.resolvedSymbol;
        if (!symbol || (symbol.kind !== "let" && symbol.kind !== "var")) continue;
        if (reportedBindings.has(symbol.id)) continue;

        const binding = context.ssa.bindingOf(reference.identifier);
        if (binding === null) continue;
        if (!context.ssa.isRedefinedBetween(node, renderExit, binding)) continue;

        reportedBindings.add(symbol.id);
        context.report({
          node: reference.identifier,
          message: `"${symbol.name}" is captured by this hook closure but reassigned later in render. The closure runs later and will read the updated value, not the one captured here.`,
        });
      }
    },
  }),
});
