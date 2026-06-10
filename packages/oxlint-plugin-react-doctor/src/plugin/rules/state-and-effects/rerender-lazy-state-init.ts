import { TRIVIAL_INITIALIZER_NAMES } from "../../constants/react.js";
import { defineRule } from "../../utils/define-rule.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const rerenderLazyStateInit = defineRule<Rule>({
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
      const calleeName = isNodeOfType(callee, "Identifier")
        ? callee.name
        : (memberPropertyName ?? "fn");

      if (TRIVIAL_INITIALIZER_NAMES.has(calleeName)) return;

      context.report({
        node: initializer,
        message: `useState(${calleeName}()) re-runs ${calleeName}() on every render & throws the result away.`,
      });
    },
  }),
});
