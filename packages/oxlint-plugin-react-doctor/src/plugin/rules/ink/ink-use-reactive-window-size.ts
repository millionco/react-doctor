import { MINIMUM_INK_VERSIONS } from "../../constants/ink.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findRenderPhaseComponentOrHook } from "../../utils/find-render-phase-component-or-hook.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isProvenGlobalNamespaceReference } from "../../utils/is-proven-global-namespace-reference.js";

const WINDOW_DIMENSION_NAMES = new Set(["columns", "rows"]);

export const inkUseReactiveWindowSize = defineRule({
  id: "ink-use-reactive-window-size",
  title: "Terminal dimensions read non-reactively",
  severity: "error",
  minimumInkVersion: MINIMUM_INK_VERSIONS.modernHooks,
  recommendation: "Use Ink's `useWindowSize()` so resize events trigger a render.",
  create: (context) => ({
    MemberExpression(node: EsTreeNodeOfType<"MemberExpression">) {
      const dimensionName = getStaticPropertyName(node);
      if (!dimensionName || !WINDOW_DIMENSION_NAMES.has(dimensionName)) return;
      if (
        !isNodeOfType(node.object, "MemberExpression") ||
        getStaticPropertyName(node.object) !== "stdout" ||
        !isProvenGlobalNamespaceReference(node.object.object, "process", context.scopes) ||
        !findRenderPhaseComponentOrHook(node, context.scopes)
      ) {
        return;
      }
      context.report({
        node,
        message: `\`process.stdout.${dimensionName}\` does not make an Ink component react to resize.`,
      });
    },
  }),
});
