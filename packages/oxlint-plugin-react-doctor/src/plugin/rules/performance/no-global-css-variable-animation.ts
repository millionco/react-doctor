import { ANIMATION_CALLBACK_NAMES } from "../../constants/style.js";
import { defineRule } from "../../utils/define-rule.js";
import { isMemberProperty } from "../../utils/is-member-property.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const noGlobalCssVariableAnimation = defineRule<Rule>({
  id: "no-global-css-variable-animation",
  title: "Animating a global CSS variable",
  tags: ["test-noise"],
  severity: "error",
  recommendation:
    "Set the variable on the element that needs it instead of a parent, or use `@property` with `inherits: false`. Better yet, update `element.style.transform` directly",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isNodeOfType(node.callee, "Identifier")) return;
      if (!ANIMATION_CALLBACK_NAMES.has(node.callee.name)) return;

      const callback = node.arguments?.[0];
      if (!callback) return;

      const calleeName = node.callee.name;
      walkAst(callback, (child: EsTreeNode) => {
        if (!isNodeOfType(child, "CallExpression")) return;
        if (!isMemberProperty(child.callee, "setProperty")) return;
        if (!isNodeOfType(child.arguments?.[0], "Literal")) return;

        const variableName = child.arguments[0].value;
        if (typeof variableName !== "string" || !variableName.startsWith("--")) return;

        context.report({
          node: child,
          message: `This forces every element using "${variableName}" to recompute its styles each frame because ${calleeName} changes it every frame, so set it on just the element that needs it`,
        });
      });
    },
  }),
});
