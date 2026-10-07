import { REACT_ROUTER_LAZY_FORBIDDEN_PROPERTY_NAMES } from "../../constants/react-router.js";
import { collectFunctionReturnStatements } from "../../utils/collect-function-return-statements.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isStaticReactRouterRouteObject } from "../../utils/is-static-react-router-route-object.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { wrapReactRouterRule } from "../../utils/wrap-react-router-rule.js";

const collectReturnedObjects = (
  functionNode: EsTreeNode,
): EsTreeNodeOfType<"ObjectExpression">[] => {
  if (!isFunctionLike(functionNode)) return [];
  const body = stripParenExpression(functionNode.body);
  if (isNodeOfType(body, "ObjectExpression")) return [body];
  return collectFunctionReturnStatements(functionNode).flatMap((returnStatement) => {
    if (returnStatement.argument === null) return [];
    const argument = stripParenExpression(returnStatement.argument);
    return isNodeOfType(argument, "ObjectExpression") ? [argument] : [];
  });
};

export const reactRouterNoInvalidLazyRouteProperties = wrapReactRouterRule(
  defineRule({
    id: "react-router-no-invalid-lazy-route-properties",
    title: "Immutable route property returned from lazy",
    tags: ["test-noise"],
    requires: ["react-router:6.9"],
    severity: "error",
    recommendation:
      "Keep route-matching properties on the static route object; lazy may return only non-matching route properties.",
    create: (context: RuleContext) => ({
      Property(node: EsTreeNodeOfType<"Property">) {
        if (getStaticPropertyKeyName(node, { allowComputedString: true }) !== "lazy") return;
        const routeObject = node.parent;
        if (!isNodeOfType(routeObject, "ObjectExpression")) return;
        if (!isStaticReactRouterRouteObject(context, routeObject)) return;
        for (const returnedObject of collectReturnedObjects(node.value)) {
          for (const property of returnedObject.properties ?? []) {
            const propertyName = getStaticPropertyKeyName(property, { allowComputedString: true });
            if (
              propertyName === null ||
              !REACT_ROUTER_LAZY_FORBIDDEN_PROPERTY_NAMES.has(propertyName)
            ) {
              continue;
            }
            context.report({
              node: property,
              message: `lazy() cannot change the route-matching property '${propertyName}'.`,
            });
          }
        }
      },
    }),
  }),
);
