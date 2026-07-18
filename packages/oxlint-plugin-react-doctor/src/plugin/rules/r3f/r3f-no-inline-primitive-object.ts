import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findRenderPhaseComponentOrHook } from "../../utils/find-render-phase-component-or-hook.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { hasR3fRuntimeImport } from "./utils/has-r3f-runtime-import.js";
import { isInsideStableR3fReactHookInitializer } from "./utils/is-inside-stable-r3f-react-hook-initializer.js";
import { resolveR3fFreshValue } from "./utils/resolve-r3f-fresh-value.js";

export const r3fNoInlinePrimitiveObject = defineRule({
  id: "r3f-no-inline-primitive-object",
  title: "Inline primitive object",
  tags: ["react-jsx-only"],
  severity: "warn",
  recommendation:
    "Create or clone the Three.js object once outside render, or memoize it, before passing it to <primitive>",
  create: (context: RuleContext) => {
    let importsReactThreeFiber = false;
    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        importsReactThreeFiber = hasR3fRuntimeImport(node, context.scopes);
      },
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (
          !importsReactThreeFiber ||
          !isNodeOfType(node.name, "JSXIdentifier") ||
          node.name.name !== "primitive" ||
          !findRenderPhaseComponentOrHook(node, context.scopes) ||
          isInsideStableR3fReactHookInitializer(node, context.scopes)
        ) {
          return;
        }
        const attribute = getAuthoritativeJsxAttribute(node.attributes, "object");
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
    };
  },
});
