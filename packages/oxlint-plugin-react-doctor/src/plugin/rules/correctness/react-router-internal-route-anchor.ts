import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticRouteFullPath } from "../../utils/get-static-route-full-path.js";
import { getStringLiteralAttributeValue } from "../../utils/get-string-literal-attribute-value.js";
import { hasActiveRouteProperty } from "../../utils/has-active-route-property.js";
import { hasJsxProp } from "../../utils/has-jsx-prop.js";
import { isJsxAttributePotentiallyTruthy } from "../../utils/is-jsx-attribute-potentially-truthy.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isStaticReactRouterRouteObject } from "../../utils/is-static-react-router-route-object.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { wrapReactRouterRule } from "../../utils/wrap-react-router-rule.js";

interface InternalAnchorCandidate {
  destination: string;
  node: EsTreeNode;
}

const UI_ROUTE_PROPERTY_NAMES = ["Component", "element", "lazy"];

export const reactRouterInternalRouteAnchor = wrapReactRouterRule(
  defineRule({
    id: "react-router-internal-route-anchor",
    title: "Internal route uses a document navigation",
    tags: ["test-noise", "react-jsx-only"],
    requires: ["react-router:6.4"],
    severity: "warn",
    recommendation: "Use React Router Link for navigation to a known UI route.",
    create: (context: RuleContext) => {
      const uiRoutePaths = new Set<string>();
      const anchorCandidates: InternalAnchorCandidate[] = [];
      return {
        ObjectExpression(node: EsTreeNodeOfType<"ObjectExpression">) {
          if (!isStaticReactRouterRouteObject(context, node)) return;
          if (
            !UI_ROUTE_PROPERTY_NAMES.some((propertyName) =>
              hasActiveRouteProperty(context, node, propertyName),
            )
          ) {
            return;
          }
          const routePath = getStaticRouteFullPath(node);
          if (routePath !== null) uiRoutePaths.add(routePath);
        },
        JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
          if (!isNodeOfType(node.name, "JSXIdentifier") || node.name.name !== "a") return;
          if (isJsxAttributePotentiallyTruthy(hasJsxProp(node.attributes ?? [], "download"))) {
            return;
          }
          const target = hasJsxProp(node.attributes ?? [], "target");
          if (target && getStringLiteralAttributeValue(target) !== "_self") return;
          const href = hasJsxProp(node.attributes ?? [], "href");
          if (!href) return;
          const destination = getStringLiteralAttributeValue(href);
          if (
            destination === null ||
            !destination.startsWith("/") ||
            destination.startsWith("//")
          ) {
            return;
          }
          anchorCandidates.push({
            destination: destination.split(/[?#]/, 1)[0] ?? destination,
            node,
          });
        },
        "Program:exit"() {
          for (const candidate of anchorCandidates) {
            if (!uiRoutePaths.has(candidate.destination)) continue;
            context.report({
              node: candidate.node,
              message: `Anchor navigates to known UI route '${candidate.destination}' with a full document request.`,
            });
          }
        },
      };
    },
  }),
);
