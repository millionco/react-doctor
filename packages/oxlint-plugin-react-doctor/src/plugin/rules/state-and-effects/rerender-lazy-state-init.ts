import { TRIVIAL_INITIALIZER_NAMES } from "../../constants/react.js";
import { defineRule } from "../../utils/define-rule.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { isReactHookName } from "../../utils/is-react-hook-name.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
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
      if (!isHookCall(node, "useState") || !node.arguments?.length) return;
      const initializer = node.arguments[0];
      if (!isNodeOfType(initializer, "CallExpression")) return;

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

      context.report({
        node: initializer,
        message: `useState(${calleeName}()) re-runs ${calleeName}() on every render & throws the result away.`,
      });
    },
  }),
});
