import { HTML_TAGS } from "../../constants/html-tags.js";
import { SVG_TAGS } from "../../constants/svg-tags.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findRenderPhaseComponentOrHook } from "../../utils/find-render-phase-component-or-hook.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { hasR3fRuntimeImport } from "./utils/has-r3f-runtime-import.js";
import { isInsideStableR3fReactHookInitializer } from "./utils/is-inside-stable-r3f-react-hook-initializer.js";
import { resolveR3fUnstableArgsElement } from "./utils/resolve-r3f-unstable-args-element.js";

export const r3fNoUnstableArgs = defineRule({
  id: "r3f-no-unstable-args",
  title: "Unstable R3F constructor args",
  tags: ["react-jsx-only"],
  severity: "warn",
  recommendation:
    "Keep reference-valued constructor arguments stable with module scope or useMemo so React Three Fiber does not reconstruct and dispose the Three.js object on a later render",
  create: (context: RuleContext) => {
    let importsReactThreeFiber = false;
    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        importsReactThreeFiber = hasR3fRuntimeImport(node, context.scopes);
      },
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (
          !importsReactThreeFiber ||
          !findRenderPhaseComponentOrHook(node, context.scopes) ||
          isInsideStableR3fReactHookInitializer(node, context.scopes) ||
          !isNodeOfType(node.name, "JSXIdentifier") ||
          node.name.name.includes("-") ||
          node.name.name[0] !== node.name.name[0]?.toLowerCase() ||
          HTML_TAGS.has(node.name.name) ||
          (SVG_TAGS.has(node.name.name) && node.name.name !== "line")
        ) {
          return;
        }
        const attribute = getAuthoritativeJsxAttribute(node.attributes, "args");
        if (
          !attribute ||
          !attribute.value ||
          !isNodeOfType(attribute.value, "JSXExpressionContainer") ||
          isNodeOfType(attribute.value.expression, "JSXEmptyExpression")
        ) {
          return;
        }
        const freshKind = resolveR3fUnstableArgsElement(attribute.value.expression, context.scopes);
        if (!freshKind) return;
        context.report({
          node: attribute.value.expression,
          message: `This ${freshKind} is a new constructor argument on every render, so React Three Fiber may reconstruct and dispose the Three.js object. Memoize it or move it to module scope`,
        });
      },
    };
  },
});
