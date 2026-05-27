import { HOOKS_WITH_DEPS } from "../../constants/react.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

interface FreshDepFinding {
  readonly hookName: string;
  readonly depKind: "object" | "array" | "function" | "JSX" | "instance";
  readonly node: EsTreeNode;
}

const classifyFreshDependency = (expression: EsTreeNode): FreshDepFinding["depKind"] | null => {
  const stripped = stripParenExpression(expression);
  if (isNodeOfType(stripped, "ObjectExpression")) return "object";
  if (isNodeOfType(stripped, "ArrayExpression")) return "array";
  if (
    isNodeOfType(stripped, "ArrowFunctionExpression") ||
    isNodeOfType(stripped, "FunctionExpression")
  ) {
    return "function";
  }
  if (isNodeOfType(stripped, "JSXElement") || isNodeOfType(stripped, "JSXFragment")) {
    return "JSX";
  }
  if (isNodeOfType(stripped, "NewExpression")) return "instance";
  return null;
};

// Hooks whose dependency arrays are compared element-wise with `===`
// (Object.is). When an element of the dep array is constructed during
// render — a fresh `{...}` / `[...]` / `() => ...` / JSX / `new Foo()`
// — the comparison always fails and the effect fires on every render.
//
// This is the most common cause of "my useEffect runs forever" bugs.
// Detection is conservative: only flag dep-array elements that are
// SYNTACTICALLY constructed in place. Identifiers (`memoizedObj`) are
// trusted because the user has already memoized them (we don't follow
// the binding to check), and method references / member accesses are
// stable enough that flagging them would over-report.
//
// Companion to `exhaustive-deps`, which catches missing deps. This
// rule catches dep array elements that exist but break the comparison
// invariant.
//
// LIMITATIONS:
//   - Spread elements (`[...someArray]`) are ignored — too uncommon
//     to handle cleanly here, and `exhaustive-deps` doesn't model
//     them either.
//   - Doesn't flag a fresh JSX literal mid-array (rare), but the
//     classifier handles it if encountered.
export const noEffectWithFreshDeps = defineRule<Rule>({
  id: "no-effect-with-fresh-deps",
  severity: "error",
  category: "State & Effects",
  recommendation:
    "Move the constructed value into the hook body (so it's recomputed during render) and instead depend on its primitive inputs, or wrap the value in useMemo / useCallback so its reference is stable.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isHookCall(node, HOOKS_WITH_DEPS)) return;
      const args = node.arguments ?? [];
      if (args.length < 2) return;

      const depsNode = args[1];
      if (!depsNode) return;
      const stripped = stripParenExpression(depsNode);
      if (!isNodeOfType(stripped, "ArrayExpression")) return;

      const calleeNode = node.callee;
      let hookName: string;
      if (isNodeOfType(calleeNode, "Identifier")) {
        hookName = calleeNode.name;
      } else if (
        isNodeOfType(calleeNode, "MemberExpression") &&
        isNodeOfType(calleeNode.property, "Identifier")
      ) {
        hookName = calleeNode.property.name;
      } else {
        hookName = "hook";
      }

      const elements = stripped.elements ?? [];
      for (const element of elements) {
        if (!element) continue;
        // Spread elements have a `type: "SpreadElement"` shape — we skip
        // them rather than try to model their referents.
        if (isNodeOfType(element, "SpreadElement")) continue;
        const depKind = classifyFreshDependency(element);
        if (!depKind) continue;
        context.report({
          node: element,
          message: `${hookName} dep array contains a freshly-allocated ${depKind}; \`===\` will always fail on this element so the hook runs every render. Move the value into the hook body or memoize it with useMemo/useCallback so its reference is stable.`,
        });
      }
    },
  }),
});
