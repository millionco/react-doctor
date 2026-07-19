import { REACT_ROUTER_RESOURCE_PATH_PATTERN } from "../../constants/react-router.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getImportedNameFromReactRouter } from "../../utils/get-imported-name-from-react-router.js";
import { getJsxPropStringValue } from "../../utils/get-jsx-prop-string-value.js";
import { hasJsxProp } from "../../utils/has-jsx-prop.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { wrapReactRouterRule } from "../../utils/wrap-react-router-rule.js";

export const reactRouterResourceLinkRequiresReload = wrapReactRouterRule(
  defineRule({
    id: "react-router-resource-link-requires-reload",
    title: "Resource link intercepted as navigation",
    tags: ["react-jsx-only"],
    requires: ["react-router"],
    severity: "error",
    recommendation:
      "Add reloadDocument to resource links so the browser downloads or opens the resource instead of client-routing it.",
    create: (context: RuleContext) => ({
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (!isNodeOfType(node.name, "JSXIdentifier")) return;
        if (getImportedNameFromReactRouter(context, node.name, node.name.name) !== "Link") return;
        if (hasJsxProp(node.attributes ?? [], "reloadDocument")) return;
        if (hasJsxProp(node.attributes ?? [], "download")) return;
        const targetAttribute = hasJsxProp(node.attributes ?? [], "target");
        if (targetAttribute && getJsxPropStringValue(targetAttribute) !== "_self") return;
        const toAttribute = hasJsxProp(node.attributes ?? [], "to");
        if (!toAttribute) return;
        const destination = getJsxPropStringValue(toAttribute);
        if (
          destination === null ||
          /^[a-z][a-z\d+.-]*:/i.test(destination) ||
          destination.startsWith("//") ||
          !REACT_ROUTER_RESOURCE_PATH_PATTERN.test(destination)
        ) {
          return;
        }
        context.report({
          node,
          message: `Link to '${destination}' is intercepted as an SPA navigation instead of a document request.`,
        });
      },
    }),
  }),
);
