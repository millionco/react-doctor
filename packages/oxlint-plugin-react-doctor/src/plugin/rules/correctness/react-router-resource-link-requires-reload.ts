import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getImportedNameFromReactRouter } from "../../utils/get-imported-name-from-react-router.js";
import { getStaticRouteFullPath } from "../../utils/get-static-route-full-path.js";
import { getStringLiteralAttributeValue } from "../../utils/get-string-literal-attribute-value.js";
import { hasActiveRouteProperty } from "../../utils/has-active-route-property.js";
import { hasJsxProp } from "../../utils/has-jsx-prop.js";
import { isJsxAttributePotentiallyTruthy } from "../../utils/is-jsx-attribute-potentially-truthy.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isStaticReactRouterRouteObject } from "../../utils/is-static-react-router-route-object.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { wrapReactRouterRule } from "../../utils/wrap-react-router-rule.js";

const RESOURCE_HANDLER_PROPERTY_NAMES = ["action", "clientAction", "clientLoader", "loader"];
const RENDER_PROPERTY_NAMES = ["Component", "element", "lazy"];

interface ResourceLinkCandidate {
  destination: string;
  importedName: string;
  node: EsTreeNodeOfType<"JSXOpeningElement">;
}

export const reactRouterResourceLinkRequiresReload = wrapReactRouterRule(
  defineRule({
    id: "react-router-resource-link-requires-reload",
    title: "Resource link intercepted as navigation",
    tags: ["react-jsx-only"],
    requires: ["react-router:6.4"],
    severity: "error",
    recommendation:
      "Add reloadDocument to resource links so the browser downloads or opens the resource instead of client-routing it.",
    create: (context: RuleContext) => {
      const resourceRoutePaths = new Set<string>();
      const linkCandidates: ResourceLinkCandidate[] = [];
      return {
        ObjectExpression(node: EsTreeNodeOfType<"ObjectExpression">) {
          if (!isStaticReactRouterRouteObject(context, node)) return;
          if (
            !RESOURCE_HANDLER_PROPERTY_NAMES.some((propertyName) =>
              hasActiveRouteProperty(context, node, propertyName),
            )
          ) {
            return;
          }
          if (
            RENDER_PROPERTY_NAMES.some((propertyName) =>
              hasActiveRouteProperty(context, node, propertyName),
            ) ||
            hasActiveRouteProperty(context, node, "children")
          ) {
            return;
          }
          const routePath = getStaticRouteFullPath(node);
          if (routePath !== null) resourceRoutePaths.add(routePath);
        },
        JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
          if (!isNodeOfType(node.name, "JSXIdentifier")) return;
          const importedName = getImportedNameFromReactRouter(context, node.name, node.name.name);
          if (importedName !== "Link" && importedName !== "NavLink") return;
          if (
            isJsxAttributePotentiallyTruthy(hasJsxProp(node.attributes ?? [], "reloadDocument"))
          ) {
            return;
          }
          if (isJsxAttributePotentiallyTruthy(hasJsxProp(node.attributes ?? [], "download"))) {
            return;
          }
          const targetAttribute = hasJsxProp(node.attributes ?? [], "target");
          if (targetAttribute && getStringLiteralAttributeValue(targetAttribute) !== "_self")
            return;
          const toAttribute = hasJsxProp(node.attributes ?? [], "to");
          if (!toAttribute) return;
          const destination = getStringLiteralAttributeValue(toAttribute);
          if (
            destination === null ||
            /^[a-z][a-z\d+.-]*:/i.test(destination) ||
            destination.startsWith("//")
          ) {
            return;
          }
          linkCandidates.push({ destination, importedName, node });
        },
        "Program:exit"() {
          for (const linkCandidate of linkCandidates) {
            const destinationPath = linkCandidate.destination.split(/[?#]/, 1)[0];
            if (!resourceRoutePaths.has(destinationPath)) continue;
            context.report({
              node: linkCandidate.node,
              message: `${linkCandidate.importedName} to '${linkCandidate.destination}' is intercepted as an SPA navigation instead of a document request.`,
            });
          }
        },
      };
    },
  }),
);
