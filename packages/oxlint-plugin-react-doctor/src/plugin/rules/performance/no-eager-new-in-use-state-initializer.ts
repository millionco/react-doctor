import { TRIVIAL_INITIALIZER_NAMES } from "../../constants/react.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";

// Sister rule to `rerender-lazy-ref-init` (which covers `useRef(new X())`)
// and `rerender-lazy-state-init` (which bails on non-CallExpression
// initializers, so `new X()` sails through). `useState` only uses its
// argument on the first render but still evaluates it every render and
// discards the result. Passing `new X()` directly constructs a fresh
// instance every render — silent allocation churn for containers
// (Map/Set/Date) and a genuine resource leak for side-effecting
// constructors (new IntersectionObserver/AbortController). The fix is the
// lazy form `useState(() => new X())`.
const findEagerNewExpression = (argument: EsTreeNode): EsTreeNode | null => {
  const stripped = stripParenExpression(argument);
  if (isNodeOfType(stripped, "NewExpression")) return stripped;
  // `useState(cond ? new A() : new B())` / `useState(flag && new A())` —
  // a branch that is directly a `new` expression still constructs eagerly.
  if (isNodeOfType(stripped, "ConditionalExpression")) {
    return (
      findEagerNewExpression(stripped.consequent) ??
      findEagerNewExpression(stripped.alternate)
    );
  }
  if (isNodeOfType(stripped, "LogicalExpression")) {
    return (
      findEagerNewExpression(stripped.left) ??
      findEagerNewExpression(stripped.right)
    );
  }
  return null;
};

const constructorName = (newExpression: EsTreeNode): string => {
  if (!isNodeOfType(newExpression, "NewExpression")) return "fn";
  const callee = newExpression.callee;
  if (isNodeOfType(callee, "Identifier")) return callee.name;
  if (
    isNodeOfType(callee, "MemberExpression") &&
    isNodeOfType(callee.property, "Identifier")
  ) {
    return callee.property.name;
  }
  return "fn";
};

export const noEagerNewInUseStateInitializer = defineRule({
  id: "no-eager-new-in-use-state-initializer",
  title: "Eager new in useState initializer runs every render",
  tags: ["test-noise"],
  severity: "warn",
  category: "Performance",
  recommendation:
    "Wrap the constructor in a function (`useState(() => new X())`) so it only runs on the first render instead of allocating (and leaking) a fresh instance every render.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isHookCall(node, "useState") || !node.arguments?.length) return;
      const eagerNew = findEagerNewExpression(node.arguments[0]);
      if (!eagerNew) return;

      const name = constructorName(eagerNew);
      if (TRIVIAL_INITIALIZER_NAMES.has(name)) return;

      context.report({
        node: eagerNew,
        message: `useState(new ${name}()) builds a fresh instance on every render and throws it away. Wrap it as useState(() => new ${name}()) so it only runs once.`,
      });
    },
  }),
});
