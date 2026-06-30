import { RENDER_FUNCTION_PATTERN } from "../../constants/react.js";
import { defineRule } from "../../utils/define-rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// `props.renderX(...)` / `this.props.renderX(...)` is a render-prop
// invocation: a function received FROM the parent, so its identity is
// owned by the parent and calling it inline remounts nothing. This is
// the idiomatic React render-prop pattern, not inline component
// construction.
const isRenderPropReceiver = (object: EsTreeNode): boolean => {
  if (isNodeOfType(object, "Identifier")) return object.name === "props";
  return (
    isNodeOfType(object, "MemberExpression") &&
    isNodeOfType(object.property, "Identifier") &&
    object.property.name === "props"
  );
};

export const noRenderInRender = defineRule({
  id: "no-render-in-render",
  title: "Component rendered by inline function call",
  severity: "warn",
  tags: ["test-noise"],
  recommendation:
    "Make it a named component so React preserves its identity and does not remount its state.",
  create: (context: RuleContext) => ({
    JSXExpressionContainer(node: EsTreeNodeOfType<"JSXExpressionContainer">) {
      const expression = node.expression;
      if (!isNodeOfType(expression, "CallExpression")) return;

      let calleeName: string | null = null;
      if (isNodeOfType(expression.callee, "Identifier")) {
        calleeName = expression.callee.name;
      } else if (
        isNodeOfType(expression.callee, "MemberExpression") &&
        isNodeOfType(expression.callee.property, "Identifier")
      ) {
        if (isRenderPropReceiver(expression.callee.object)) return;
        calleeName = expression.callee.property.name;
      }

      if (!calleeName || !RENDER_FUNCTION_PATTERN.test(calleeName)) return;

      context.report({
        node: expression,
        message: `Your users lose state because "${calleeName}()" builds UI from an inline call that React remounts, so pull it into its own component instead.`,
      });
    },
  }),
});
