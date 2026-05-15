import { LOADING_STATE_PATTERN } from "../../constants/react.js";
import { defineRule } from "../../utils/define-rule.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const renderingUsetransitionLoading = defineRule<Rule>({
  id: "rendering-usetransition-loading",
  severity: "warn",
  recommendation:
    "Replace with `const [isPending, startTransition] = useTransition()` — avoids a re-render for the loading state",
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

      context.report({
        node: node.init,
        message: `useState for "${stateVariableName}" — if this guards a state transition (not an async fetch), consider useTransition instead`,
      });
    },
  }),
});
