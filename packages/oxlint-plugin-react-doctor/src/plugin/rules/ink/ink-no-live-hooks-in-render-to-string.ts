import { MINIMUM_INK_VERSIONS } from "../../constants/ink.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findRenderPhaseComponentOrHook } from "../../utils/find-render-phase-component-or-hook.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveInkApiName } from "../../utils/resolve-ink-api-name.js";
import {
  collectInkRenderCalls,
  resolveInkRenderCallsForNode,
} from "../../utils/resolve-ink-render-calls.js";
import { walkAst } from "../../utils/walk-ast.js";

const INERT_INPUT_HOOK_NAMES = new Set(["useInput", "usePaste"]);

const isExportedComponent = (componentNode: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  let bindingIdentifier: EsTreeNode | null = null;
  if (isNodeOfType(componentNode, "FunctionDeclaration") && componentNode.id) {
    bindingIdentifier = componentNode.id;
  } else if (
    isNodeOfType(componentNode.parent, "VariableDeclarator") &&
    componentNode.parent.init === componentNode &&
    isNodeOfType(componentNode.parent.id, "Identifier")
  ) {
    bindingIdentifier = componentNode.parent.id;
  }
  const symbol = bindingIdentifier ? scopes.symbolFor(bindingIdentifier) : null;
  const declarationParent = symbol?.declarationNode.parent;
  const isDirectExport =
    isNodeOfType(declarationParent, "ExportDefaultDeclaration") ||
    isNodeOfType(declarationParent, "ExportNamedDeclaration") ||
    (isNodeOfType(declarationParent, "VariableDeclaration") &&
      isNodeOfType(declarationParent.parent, "ExportNamedDeclaration"));
  if (isDirectExport) return true;
  return Boolean(
    symbol?.references.some((reference) => {
      const parentNode = reference.identifier.parent;
      return (
        isNodeOfType(parentNode, "ExportDefaultDeclaration") ||
        (isNodeOfType(parentNode, "ExportSpecifier") && parentNode.local === reference.identifier)
      );
    }),
  );
};

export const inkNoLiveHooksInRenderToString = defineRule({
  id: "ink-no-live-hooks-in-render-to-string",
  title: "Inert input hook used during string rendering",
  severity: "error",
  minimumInkVersion: MINIMUM_INK_VERSIONS.renderToString,
  recommendation: "Keep input subscriptions out of components used only by `renderToString()`.",
  create: (context) => ({
    Program(node: EsTreeNodeOfType<"Program">) {
      const renderCalls = collectInkRenderCalls(node, context, "renderToString");
      if (renderCalls.length === 0) return;
      const liveRenderCalls = collectInkRenderCalls(node, context);
      walkAst(node, (descendantNode) => {
        if (!isNodeOfType(descendantNode, "CallExpression")) return;
        const hookName = resolveInkApiName(descendantNode.callee, context.scopes);
        if (!hookName || !INERT_INPUT_HOOK_NAMES.has(hookName)) return;
        const componentNode = findRenderPhaseComponentOrHook(descendantNode, context.scopes);
        if (!componentNode || isExportedComponent(componentNode, context.scopes)) return;
        const relatedRenderCalls = resolveInkRenderCallsForNode(
          descendantNode,
          renderCalls,
          context,
        );
        if (relatedRenderCalls.length === 0) return;
        if (resolveInkRenderCallsForNode(descendantNode, liveRenderCalls, context).length > 0) {
          return;
        }
        context.report({
          node: descendantNode,
          message: `Ink \`${hookName}\` never receives input under \`renderToString()\`.`,
        });
      });
    },
  }),
});
