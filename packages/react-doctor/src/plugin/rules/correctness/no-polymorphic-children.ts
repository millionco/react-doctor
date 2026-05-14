import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// HACK: `typeof children === "string"` (or `=== 'object'`) is a
// polymorphic-children smell — the component switches behavior based on
// what the consumer happened to pass. Better to expose explicit
// subcomponents (`<Button.Text />`) so text always lands in the right
// shape and the component's API is checked at compile time.
export const noPolymorphicChildren = defineRule<Rule>({
  id: "no-polymorphic-children",
  framework: "global",
  severity: "warn",
  category: "Architecture",
  recommendation:
    "Expose explicit subcomponents (`<Button.Text>`, `<Button.Icon>`) so consumers don't need to switch on `typeof children`",
  examples: [
    {
      before:
        "function Button({ children }) {\n  if (typeof children === 'string') return <span>{children}</span>;\n  return <div>{children}</div>;\n}",
      after:
        "function Button({ children }) { return <div>{children}</div>; }\nButton.Text = ({ children }) => <span>{children}</span>;",
    },
  ],
  create: (context: RuleContext) => ({
    BinaryExpression(node: EsTreeNodeOfType<"BinaryExpression">) {
      if (node.operator !== "===" && node.operator !== "==") return;

      const isTypeofChildren = (operand: EsTreeNode | undefined): boolean =>
        isNodeOfType(operand, "UnaryExpression") &&
        operand.operator === "typeof" &&
        isNodeOfType(operand.argument, "Identifier") &&
        operand.argument.name === "children";

      if (!isTypeofChildren(node.left) && !isTypeofChildren(node.right)) return;

      const isStringLiteral = (operand: EsTreeNode | undefined): boolean =>
        isNodeOfType(operand, "Literal") && operand.value === "string";

      if (!isStringLiteral(node.left) && !isStringLiteral(node.right)) return;

      context.report({
        node,
        message:
          'Polymorphic `typeof children === "string"` check — expose explicit subcomponents (e.g. `<Button.Text>`) instead of branching on what the consumer passed',
      });
    },
  }),
});
