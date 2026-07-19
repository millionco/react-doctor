import { MINIMUM_INK_VERSIONS } from "../../constants/ink.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeConditionallyExecuted } from "../../utils/is-node-conditionally-executed.js";
import { resolveInkJsxElementName } from "../../utils/resolve-ink-api-name.js";

export const inkNoMultipleStatic = defineRule({
  id: "ink-no-multiple-static",
  title: "Multiple Static regions in one Ink tree",
  severity: "warn",
  minimumInkVersion: MINIMUM_INK_VERSIONS.base,
  recommendation: "Consolidate permanent output into one `<Static>` region when possible.",
  create: (context) => {
    const staticNodesByRenderRoot = new Map<EsTreeNode, EsTreeNodeOfType<"JSXOpeningElement">[]>();
    return {
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (resolveInkJsxElementName(node, context.scopes) !== "Static") return;
        const owner = context.cfg.enclosingFunction(node);
        if (!owner) return;
        let renderRoot = node.parent;
        let ancestorNode = renderRoot?.parent;
        while (ancestorNode && ancestorNode !== owner) {
          if (ancestorNode.type === "JSXAttribute" || /Function/.test(ancestorNode.type)) return;
          if (ancestorNode.type === "JSXElement" || ancestorNode.type === "JSXFragment") {
            renderRoot = ancestorNode;
          }
          ancestorNode = ancestorNode.parent;
        }
        if (!renderRoot) return;
        const previousStaticNodes = staticNodesByRenderRoot.get(renderRoot) ?? [];
        staticNodesByRenderRoot.set(renderRoot, [...previousStaticNodes, node]);
        if (isNodeConditionallyExecuted(node, renderRoot)) return;
        if (
          !previousStaticNodes.some(
            (previousStaticNode) => !isNodeConditionallyExecuted(previousStaticNode, renderRoot),
          )
        ) {
          return;
        }
        context.report({
          node,
          message:
            "Multiple `<Static>` regions make permanent output ordering difficult to reason about.",
        });
      },
    };
  },
});
