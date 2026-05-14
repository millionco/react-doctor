import { createComponentPropStackTracker } from "../../utils/create-component-prop-stack-tracker.js";
import { defineRule } from "../../utils/define-rule.js";
import { getRootIdentifierName } from "../../utils/get-root-identifier-name.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const noDerivedUseState = defineRule<Rule>({
  framework: "global",
  severity: "warn",
  category: "State & Effects",
  recommendation:
    "Remove useState and compute the value inline: `const value = transform(propName)`",
  examples: [
    {
      before:
        "function List({ items }) {\n  const [filtered, setFiltered] = useState(items.filter((i) => i.active));\n  return <Rows items={filtered} />;\n}",
      after:
        "function List({ items }) {\n  const filtered = items.filter((i) => i.active);\n  return <Rows items={filtered} />;\n}",
    },
  ],
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
          context.report({
            node,
            message: `useState initialized from prop "${initializer.name}" — if this value should stay in sync with the prop, derive it during render instead`,
          });
          return;
        }

        if (isNodeOfType(initializer, "MemberExpression") && !initializer.computed) {
          const rootIdentifierName = getRootIdentifierName(initializer);
          if (rootIdentifierName && propStackTracker.isPropName(rootIdentifierName)) {
            context.report({
              node,
              message: `useState initialized from prop "${rootIdentifierName}" — if this value should stay in sync with the prop, derive it during render instead`,
            });
          }
        }
      },
    };
  },
});
