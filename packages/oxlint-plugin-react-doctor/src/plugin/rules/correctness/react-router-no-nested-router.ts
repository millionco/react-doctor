import { REACT_ROUTER_COMPONENT_ROUTER_EXPORT_NAMES } from "../../constants/react-router.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getImportedNameFromReactRouter } from "../../utils/get-imported-name-from-react-router.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { wrapReactRouterRule } from "../../utils/wrap-react-router-rule.js";

const isRouterElement = (context: RuleContext, node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "JSXElement")) return false;
  const elementName = node.openingElement.name;
  if (!isNodeOfType(elementName, "JSXIdentifier")) return false;
  const importedName = getImportedNameFromReactRouter(context, elementName, elementName.name);
  return importedName !== null && REACT_ROUTER_COMPONENT_ROUTER_EXPORT_NAMES.has(importedName);
};

export const reactRouterNoNestedRouter = wrapReactRouterRule(
  defineRule({
    id: "react-router-no-nested-router",
    title: "Router nested inside another router",
    tags: ["react-jsx-only"],
    requires: ["react-router"],
    severity: "error",
    recommendation: "Keep one router provider at the application root.",
    create: (context: RuleContext) => ({
      JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
        if (!isRouterElement(context, node)) return;
        let ancestor = node.parent;
        while (ancestor !== null && ancestor !== undefined) {
          if (isRouterElement(context, ancestor)) {
            context.report({
              node,
              message: "This router is directly nested under another router provider.",
            });
            return;
          }
          ancestor = ancestor.parent;
        }
      },
    }),
  }),
);
