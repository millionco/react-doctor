import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

const EXPENSIVE_TYPES = new Set<string>(["JSXElement", "JSXFragment", "Identifier"]);

const visitLogicalExpression = (
  node: EsTreeNodeOfType<"LogicalExpression">,
  context: RuleContext,
): void => {
  if (node.operator !== "&&") return;
  if (!EXPENSIVE_TYPES.has(node.right.type)) return;
  context.report({
    node,
    message: "Use Solid's `<Show />` component for conditionally showing content.",
  });
};

const visitConditionalExpression = (
  node: EsTreeNodeOfType<"ConditionalExpression">,
  context: RuleContext,
): void => {
  if (!EXPENSIVE_TYPES.has(node.consequent.type) && !EXPENSIVE_TYPES.has(node.alternate.type)) {
    return;
  }
  context.report({
    node,
    message: "Use Solid's `<Show />` component for conditionally showing content with a fallback.",
  });
};

// Port of `solid/prefer-show` — stylistic preference, off by
// default. Suggests `<Show>` over `condition && jsx` or ternary
// expressions in JSX. Solid's compiler optimises both forms, so
// this is purely a readability hint.
export const solidPreferShow = defineRule<Rule>({
  id: "solid-prefer-show",
  severity: "warn",
  requires: ["solid"],
  defaultEnabled: false,
  recommendation: "Prefer `<Show when={cond}>` over `cond && <Jsx />` for conditional rendering.",
  create: (context: RuleContext) => ({
    JSXExpressionContainer(node: EsTreeNodeOfType<"JSXExpressionContainer">) {
      const parent = node.parent;
      if (
        !parent ||
        (!isNodeOfType(parent, "JSXElement") && !isNodeOfType(parent, "JSXFragment"))
      ) {
        return;
      }
      const expression = node.expression as EsTreeNode;
      if (isNodeOfType(expression, "LogicalExpression")) {
        visitLogicalExpression(expression, context);
        return;
      }
      if (isNodeOfType(expression, "ConditionalExpression")) {
        visitConditionalExpression(expression, context);
        return;
      }
      if (isNodeOfType(expression, "ArrowFunctionExpression")) {
        const body = expression.body;
        if (isNodeOfType(body, "LogicalExpression")) visitLogicalExpression(body, context);
        else if (isNodeOfType(body, "ConditionalExpression")) {
          visitConditionalExpression(body, context);
        }
      }
    },
  }),
});
