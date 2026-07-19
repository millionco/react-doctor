import { MINIMUM_INK_VERSIONS } from "../../constants/ink.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findRenderPhaseComponentOrHook } from "../../utils/find-render-phase-component-or-hook.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isProvenGlobalNamespaceReference } from "../../utils/is-proven-global-namespace-reference.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import { walkAst } from "../../utils/walk-ast.js";

const WINDOW_DIMENSION_NAMES = new Set(["columns", "rows"]);
const RESIZE_LISTENER_METHOD_NAMES = new Set(["addListener", "on", "once"]);

const isProcessStdout = (node: EsTreeNode, scopes: ScopeAnalysis): boolean =>
  isNodeOfType(node, "MemberExpression") &&
  getStaticPropertyName(node) === "stdout" &&
  isProvenGlobalNamespaceReference(node.object, "process", scopes);

const hasStdoutResizeListener = (componentNode: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  let hasListener = false;
  walkAst(componentNode, (descendantNode) => {
    if (
      !isNodeOfType(descendantNode, "CallExpression") ||
      !isNodeOfType(descendantNode.callee, "MemberExpression") ||
      !RESIZE_LISTENER_METHOD_NAMES.has(getStaticPropertyName(descendantNode.callee) ?? "") ||
      !isProcessStdout(descendantNode.callee.object, scopes) ||
      !isNodeOfType(descendantNode.arguments[0], "Literal") ||
      descendantNode.arguments[0].value !== "resize"
    ) {
      return;
    }
    hasListener = true;
    return false;
  });
  return hasListener;
};

export const inkUseReactiveWindowSize = defineRule({
  id: "ink-use-reactive-window-size",
  title: "Terminal dimensions read non-reactively",
  severity: "warn",
  minimumInkVersion: MINIMUM_INK_VERSIONS.modernHooks,
  recommendation: "Use Ink's `useWindowSize()` so resize events trigger a render.",
  create: (context) => ({
    MemberExpression(node: EsTreeNodeOfType<"MemberExpression">) {
      const dimensionName = getStaticPropertyName(node);
      if (!dimensionName || !WINDOW_DIMENSION_NAMES.has(dimensionName)) return;
      const componentNode = findRenderPhaseComponentOrHook(node, context.scopes);
      if (
        !isNodeOfType(node.object, "MemberExpression") ||
        getStaticPropertyName(node.object) !== "stdout" ||
        !isProvenGlobalNamespaceReference(node.object.object, "process", context.scopes) ||
        !componentNode ||
        hasStdoutResizeListener(componentNode, context.scopes)
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
