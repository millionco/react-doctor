import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getImportedNameFromReactRouter } from "../../utils/get-imported-name-from-react-router.js";
import { hasCapability } from "../../utils/get-react-doctor-setting.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactRouterRouteFunction } from "../../utils/is-react-router-route-function.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { wrapReactRouterRule } from "../../utils/wrap-react-router-rule.js";

const reportDataProperties = (context: RuleContext, pattern: EsTreeNode): void => {
  if (!isNodeOfType(pattern, "ObjectPattern")) return;
  for (const property of pattern.properties ?? []) {
    if (getStaticPropertyKeyName(property, { allowComputedString: true }) !== "data") continue;
    context.report({
      node: property,
      message: "The meta data field was removed in React Router v8; use loaderData.",
    });
  }
};

export const reactRouterV8NoMetaDataField = wrapReactRouterRule(
  defineRule({
    id: "react-router-v8-no-meta-data-field",
    title: "Removed meta data field",
    tags: ["migration-hint"],
    requires: ["react-router:8"],
    severity: "error",
    category: "Architecture",
    recommendation: "Read loaderData instead of the removed data field.",
    create: (context: RuleContext) => {
      const hasFrameworkMode = hasCapability(context.settings, "react-router-framework");
      return {
        FunctionDeclaration(node: EsTreeNodeOfType<"FunctionDeclaration">) {
          if (!hasFrameworkMode) return;
          if (!isReactRouterRouteFunction(context, node, "meta")) return;
          const firstParameter = node.params?.[0];
          if (firstParameter) reportDataProperties(context, firstParameter);
        },
        VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
          if (
            hasFrameworkMode &&
            isFunctionLike(node.init) &&
            isReactRouterRouteFunction(context, node.init, "meta")
          ) {
            const firstParameter = node.init.params?.[0];
            if (firstParameter) reportDataProperties(context, firstParameter);
          }
          if (!isNodeOfType(node.init, "CallExpression")) return;
          if (!isNodeOfType(node.init.callee, "Identifier")) return;
          if (
            getImportedNameFromReactRouter(context, node.init.callee, node.init.callee.name) !==
            "useMatches"
          ) {
            return;
          }
          if (isNodeOfType(node.id, "ArrayPattern")) {
            for (const element of node.id.elements ?? []) {
              if (element) reportDataProperties(context, element);
            }
          } else {
            reportDataProperties(context, node.id);
          }
        },
      };
    },
  }),
);
