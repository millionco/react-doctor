import { createComponentPropStackTracker } from "../../utils/create-component-prop-stack-tracker.js";
import { defineRule } from "../../utils/define-rule.js";
import { getRootIdentifierName } from "../../utils/get-root-identifier-name.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { isInitialOnlyPropName } from "../../utils/is-initial-only-prop-name.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const noDerivedUseState = defineRule<Rule>({
  id: "no-derived-useState",
  title: "Prop derived into useState",
  tags: ["test-noise"],
  severity: "warn",
  recommendation:
    "Remove useState and compute the value inline: `const value = transform(propName)`",
  create: (context: RuleContext) => {
    const propStackTracker = createComponentPropStackTracker();

    return {
      ...propStackTracker.visitors,
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (!isHookCall(node, "useState") || !node.arguments?.length) return;
        const initializer = node.arguments[0];

        if (
          isNodeOfType(initializer, "Identifier") &&
          propStackTracker.isPropName(initializer.name)
        ) {
          if (isInitialOnlyPropName(initializer.name)) return;
          context.report({
            node,
            message: `Your users see a stale value when prop "${initializer.name}" changes because useState copies it once.`,
          });
          return;
        }

        if (isNodeOfType(initializer, "MemberExpression") && !initializer.computed) {
          const rootIdentifierName = getRootIdentifierName(initializer);
          if (rootIdentifierName && propStackTracker.isPropName(rootIdentifierName)) {
            // Last property name in `props.initialValue` style chains
            // — if that's an initial-only name, skip too.
            if (
              isNodeOfType(initializer.property, "Identifier") &&
              isInitialOnlyPropName(initializer.property.name)
            ) {
              return;
            }
            context.report({
              node,
              message: `Your users see a stale value when prop "${rootIdentifierName}" changes because useState copies it once.`,
            });
          }
        }
      },
    };
  },
});
