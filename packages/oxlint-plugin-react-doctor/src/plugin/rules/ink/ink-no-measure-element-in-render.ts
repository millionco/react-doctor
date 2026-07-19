import { MINIMUM_INK_VERSIONS } from "../../constants/ink.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findRenderPhaseComponentOrHook } from "../../utils/find-render-phase-component-or-hook.js";
import { resolveInkApiName } from "../../utils/resolve-ink-api-name.js";

export const inkNoMeasureElementInRender = defineRule({
  id: "ink-no-measure-element-in-render",
  title: "Ink element measured during render",
  severity: "error",
  minimumInkVersion: MINIMUM_INK_VERSIONS.base,
  recommendation:
    "Measure Ink elements in a layout effect, effect, callback ref, or event handler.",
  create: (context) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (
        resolveInkApiName(node.callee, context.scopes) !== "measureElement" ||
        !findRenderPhaseComponentOrHook(node, context.scopes)
      ) {
        return;
      }
      context.report({
        node,
        message: "Calling `measureElement` during render reads layout before Ink commits it.",
      });
    },
  }),
});
