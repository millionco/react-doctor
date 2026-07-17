import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import { findRenderPhaseComponentOrHook } from "../../utils/find-render-phase-component-or-hook.js";
import { isInsideStableReactHookInitializer } from "../../utils/is-inside-stable-react-hook-initializer.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { resolveR3fFreshValue } from "./utils/resolve-r3f-fresh-value.js";

export const r3fNoInlinePrimitiveObject = defineRule({
  id: "r3f-no-inline-primitive-object",
  title: "Inline primitive object",
  tags: ["react-jsx-only"],
  severity: "warn",
  recommendation:
    "Create or clone the Three.js object once outside render, or memoize it, before passing it to <primitive>",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (
        !isNodeOfType(node.name, "JSXIdentifier") ||
        node.name.name !== "primitive" ||
        !findRenderPhaseComponentOrHook(node, context.scopes) ||
        isInsideStableReactHookInitializer(node, context.scopes)
      ) {
        return;
      }
      const attribute = findJsxAttribute(node.attributes, "object");
      if (
        !attribute ||
        !attribute.value ||
        !isNodeOfType(attribute.value, "JSXExpressionContainer") ||
        isNodeOfType(attribute.value.expression, "JSXEmptyExpression")
      ) {
        return;
      }
      const freshKind = resolveR3fFreshValue(attribute.value.expression, context.scopes);
      if (!freshKind) return;
      context.report({
        node: attribute.value.expression,
        message: `This ${freshKind} creates a different object for <primitive> on every render. Reuse a stable object created outside render or with useMemo`,
      });
    },
  }),
});
