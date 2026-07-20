import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticRouteProperty } from "../../utils/get-static-route-property.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactApiCall } from "../../utils/is-react-api-call.js";
import { isStaticReactRouterRouteObject } from "../../utils/is-static-react-router-route-object.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { wrapReactRouterRule } from "../../utils/wrap-react-router-rule.js";

const getEagerRouteComponent = (propertyValue: EsTreeNode): EsTreeNode | null => {
  if (isNodeOfType(propertyValue, "Identifier")) return propertyValue;
  if (
    isNodeOfType(propertyValue, "JSXElement") &&
    isNodeOfType(propertyValue.openingElement.name, "JSXIdentifier")
  ) {
    return propertyValue.openingElement.name;
  }
  return null;
};

export const reactRouterPreferRouteLazy = wrapReactRouterRule(
  defineRule({
    id: "react-router-prefer-route-lazy",
    title: "React.lazy creates a route-module waterfall",
    tags: ["test-noise"],
    requires: ["react-router:6.9"],
    disabledWhen: ["react-router-framework"],
    severity: "warn",
    category: "Performance",
    recommendation:
      "Load route modules with the route lazy property so initial navigation does not download every route component.",
    create: (context: RuleContext) => ({
      ObjectExpression(node: EsTreeNodeOfType<"ObjectExpression">) {
        if (!isStaticReactRouterRouteObject(context, node)) return;
        if (getStaticRouteProperty(node, "lazy") !== null) return;
        const contentProperty =
          getStaticRouteProperty(node, "Component") ?? getStaticRouteProperty(node, "element");
        if (contentProperty === null) return;
        const component = getEagerRouteComponent(contentProperty.value);
        if (component === null) return;
        const componentSymbol = context.scopes.symbolFor(component);
        if (
          componentSymbol?.kind !== "const" ||
          !componentSymbol.initializer ||
          !isReactApiCall(componentSymbol.initializer, "lazy", context.scopes, {
            allowGlobalReactNamespace: true,
            resolveNamedAliases: true,
          })
        ) {
          return;
        }
        context.report({
          node: contentProperty,
          message:
            "React.lazy defers only the component; use the route lazy property to load the full route module in parallel.",
        });
      },
    }),
  }),
);
