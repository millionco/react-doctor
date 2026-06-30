import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// True only when the `children` operand resolves to the enclosing
// component's `props.children` — a destructured prop binding
// (`({ children }) => …`, a `parameter` symbol) or a `props.children`
// member access where `props` is the component's parameter. A local
// variable or data field that happens to be named `children`
// (`const { children } = node`) is not a polymorphic-children smell.
const resolvesToPropsChildren = (operand: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (isNodeOfType(operand, "Identifier") && operand.name === "children") {
    return scopes.symbolFor(operand)?.kind === "parameter";
  }
  if (
    isNodeOfType(operand, "MemberExpression") &&
    !operand.computed &&
    isNodeOfType(operand.property, "Identifier") &&
    operand.property.name === "children" &&
    isNodeOfType(operand.object, "Identifier")
  ) {
    return scopes.symbolFor(operand.object)?.kind === "parameter";
  }
  return false;
};

// HACK: `typeof children === "string"` (or `=== 'object'`) is a
// polymorphic-children smell — the component switches behavior based on
// what the consumer happened to pass. Better to expose explicit
// subcomponents (`<Button.Text />`) so text always lands in the right
// shape and the component's API is checked at compile time.
export const noPolymorphicChildren = defineRule({
  id: "no-polymorphic-children",
  title: "Children type checked at runtime",
  severity: "warn",
  category: "Architecture",
  recommendation:
    "Add clear subcomponents like `<Button.Text>` and `<Button.Icon>` so callers don't have to check `typeof children`.",
  create: (context: RuleContext) => ({
    BinaryExpression(node: EsTreeNodeOfType<"BinaryExpression">) {
      if (node.operator !== "===" && node.operator !== "==") return;

      const isTypeofChildren = (operand: EsTreeNode | undefined): boolean =>
        isNodeOfType(operand, "UnaryExpression") &&
        operand.operator === "typeof" &&
        resolvesToPropsChildren(operand.argument, context.scopes);

      if (!isTypeofChildren(node.left) && !isTypeofChildren(node.right)) return;

      const isStringLiteral = (operand: EsTreeNode | undefined): boolean =>
        isNodeOfType(operand, "Literal") && operand.value === "string";

      if (!isStringLiteral(node.left) && !isStringLiteral(node.right)) return;

      context.report({
        node,
        message:
          'Your users hit inconsistent behavior because `typeof children === "string"` makes this component switch on what callers pass, so add clear subcomponents like `<Button.Text>` instead.',
      });
    },
  }),
});
