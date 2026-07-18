import { TRIVIAL_INITIALIZER_NAMES } from "../../constants/react.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { isReactHookCall } from "../../utils/is-react-hook-call.js";
import { isReactHookName } from "../../utils/is-react-hook-name.js";
import { isTrivialBuiltInConstruction } from "../../utils/is-trivial-built-in-construction.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// Zero-argument native Date getters (`now.getMonth()`, `Date.now()`) cost
// nanoseconds — lazy-wrapping them is pure noise, and the rule's purpose is
// expensive initializers (JSON.parse, large array builds).
const TRIVIAL_DATE_GETTER_NAMES: ReadonlySet<string> = new Set([
  "now",
  "getTime",
  "getFullYear",
  "getMonth",
  "getDate",
  "getDay",
  "getHours",
  "getMinutes",
  "getSeconds",
  "getMilliseconds",
  "getTimezoneOffset",
  "getUTCFullYear",
  "getUTCMonth",
  "getUTCDate",
  "getUTCDay",
  "getUTCHours",
  "getUTCMinutes",
  "getUTCSeconds",
  "getUTCMilliseconds",
  "valueOf",
]);

const EAGER_CALL_RESOLUTION_DEPTH_LIMIT = 4;

// The call (or constructor) that runs eagerly on EVERY render inside a
// `useState(...)` argument. Beyond a bare `expensiveFn()`, wrapper
// shapes still evaluate the call unconditionally each render:
//   - `expensiveFn(raw) ?? []` / `expensiveFn(raw) || []` — the left of
//     a logical expression always evaluates;
//   - `[...expensiveFn(raw)]` — a spread eagerly iterates the call;
//   - `new HeavyModel(config)` — a constructor is a call by another name;
//   - `computeLayout(width).sections` — the member read forces the call.
// Right-hand logical operands and plain array elements are left alone:
// the former is conditionally evaluated, the latter overlaps common
// cheap `useState([value])` literals.
const findEagerInitializerCall = (
  expression: EsTreeNode,
  depth = 0,
): EsTreeNodeOfType<"CallExpression"> | EsTreeNodeOfType<"NewExpression"> | null => {
  if (depth > EAGER_CALL_RESOLUTION_DEPTH_LIMIT) return null;
  // TS wrappers (`makeRows(raw) as Rows`, `buildModel(config)!`) and
  // optional chains are transparent — the call still runs every render.
  const innerExpression = stripParenExpression(expression);
  if (
    isNodeOfType(innerExpression, "CallExpression") ||
    isNodeOfType(innerExpression, "NewExpression")
  ) {
    return innerExpression;
  }
  if (isNodeOfType(innerExpression, "LogicalExpression")) {
    return findEagerInitializerCall(innerExpression.left as EsTreeNode, depth + 1);
  }
  if (isNodeOfType(innerExpression, "MemberExpression")) {
    return findEagerInitializerCall(innerExpression.object as EsTreeNode, depth + 1);
  }
  if (isNodeOfType(innerExpression, "ArrayExpression")) {
    for (const element of innerExpression.elements ?? []) {
      if (!element || !isNodeOfType(element, "SpreadElement")) continue;
      const spreadCall = findEagerInitializerCall(element.argument as EsTreeNode, depth + 1);
      if (spreadCall) return spreadCall;
    }
  }
  return null;
};

export const rerenderLazyStateInit = defineRule({
  id: "rerender-lazy-state-init",
  title: "State initializer runs on every render",
  tags: ["test-noise"],
  severity: "warn",
  category: "Performance",
  recommendation:
    "Wrap expensive initial state in an arrow function so the initializer does not rerun and get thrown away on every render.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isReactHookCall(node, "useState", context.scopes) || !node.arguments?.length) return;
      const initializer = findEagerInitializerCall(node.arguments[0] as EsTreeNode);
      if (!initializer) return;
      const isConstructor = isNodeOfType(initializer, "NewExpression");

      const callee = initializer.callee;
      const memberPropertyName =
        isNodeOfType(callee, "MemberExpression") &&
        (isNodeOfType(callee.property, "Identifier") ||
          isNodeOfType(callee.property, "PrivateIdentifier"))
          ? callee.property.name
          : null;
      const calleeIsIdentifier = isNodeOfType(callee, "Identifier");
      const calleeName = calleeIsIdentifier ? callee.name : (memberPropertyName ?? "fn");

      if (TRIVIAL_INITIALIZER_NAMES.has(calleeName)) return;
      if (isTrivialBuiltInConstruction(initializer)) return;
      if (
        memberPropertyName &&
        (initializer.arguments ?? []).length === 0 &&
        TRIVIAL_DATE_GETTER_NAMES.has(memberPropertyName)
      ) {
        return;
      }

      // `useState(useContext(Ctx))` / `useState(React.useContext(Ctx))` /
      // `useState(useLocalStorageDefault(...))` captures another hook's value.
      // Wrapping it in a lazy initializer (`useState(() => useContext(Ctx))`)
      // would call a hook conditionally — an illegal rules-of-hooks violation.
      // Skip hook-shaped callees (identifier or member form), matching the
      // sibling `rerender-lazy-ref-init`.
      if (isReactHookName(calleeName)) return;

      const callDescription = isConstructor ? `new ${calleeName}()` : `${calleeName}()`;
      context.report({
        node: initializer,
        message: `useState(${callDescription}) re-runs ${callDescription} on every render & throws the result away.`,
      });
    },
  }),
});
