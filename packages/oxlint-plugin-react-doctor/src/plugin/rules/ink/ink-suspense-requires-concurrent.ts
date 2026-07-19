import { MINIMUM_INK_VERSIONS } from "../../constants/ink.js";
import { containsInkJsxElement } from "../../utils/contains-ink-jsx-element.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getImportedNameFromModule } from "../../utils/find-import-source-for-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import {
  collectInkRenderCalls,
  getInkRenderBooleanOption,
  resolveInkRenderCallsForNode,
} from "../../utils/resolve-ink-render-calls.js";
import { walkAst } from "../../utils/walk-ast.js";

export const inkSuspenseRequiresConcurrent = defineRule({
  id: "ink-suspense-requires-concurrent",
  title: "Ink Suspense without concurrent rendering",
  severity: "error",
  minimumInkVersion: MINIMUM_INK_VERSIONS.concurrent,
  recommendation: "Enable `{concurrent: true}` on Ink `render()` when the tree uses Suspense.",
  create: (context) => ({
    Program(node: EsTreeNodeOfType<"Program">) {
      const renderCalls = collectInkRenderCalls(node, context);
      walkAst(node, (descendantNode) => {
        if (
          !isNodeOfType(descendantNode, "JSXOpeningElement") ||
          !isNodeOfType(descendantNode.name, "JSXIdentifier") ||
          context.scopes.symbolFor(descendantNode.name)?.kind !== "import" ||
          getImportedNameFromModule(descendantNode, descendantNode.name.name, "react") !==
            "Suspense" ||
          !descendantNode.parent ||
          !containsInkJsxElement(descendantNode.parent, context.scopes)
        ) {
          return;
        }
        const relatedRenderCalls = resolveInkRenderCallsForNode(
          descendantNode,
          renderCalls,
          context,
        );
        if (
          relatedRenderCalls.length === 0 ||
          !relatedRenderCalls.some(
            (renderCall) =>
              getInkRenderBooleanOption(renderCall.node, "concurrent", false) === false,
          )
        ) {
          return;
        }
        context.report({
          node: descendantNode,
          message: "Ink Suspense boundaries require the renderer's `concurrent` option.",
        });
      });
    },
  }),
});
