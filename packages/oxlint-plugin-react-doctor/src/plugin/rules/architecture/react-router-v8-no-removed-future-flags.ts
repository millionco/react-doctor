import { REACT_ROUTER_V8_REMOVED_FUTURE_FLAG_NAMES } from "../../constants/react-router.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { RuleVisitors } from "../../utils/rule-visitors.js";
import { wrapReactRouterRule } from "../../utils/wrap-react-router-rule.js";

const REACT_ROUTER_CONFIG_PATTERN = /(?:^|\/)react-router\.config\.[cm]?[jt]s$/;
const EMPTY_VISITORS: RuleVisitors = {};

export const reactRouterV8NoRemovedFutureFlags = wrapReactRouterRule(
  defineRule({
    id: "react-router-v8-no-removed-future-flags",
    title: "Removed React Router future flag",
    tags: ["migration-hint"],
    requires: ["react-router:8", "react-router-framework"],
    severity: "error",
    category: "Architecture",
    recommendation:
      "Remove v8 future flags; move v8_splitRouteModules to the top-level splitRouteModules option.",
    create: (context: RuleContext) => {
      if (context.filename && !REACT_ROUTER_CONFIG_PATTERN.test(context.filename)) {
        return EMPTY_VISITORS;
      }
      return {
        Property(node: EsTreeNodeOfType<"Property">) {
          if (getStaticPropertyKeyName(node, { allowComputedString: true }) !== "future") return;
          if (!isNodeOfType(node.value, "ObjectExpression")) return;
          for (const property of node.value.properties ?? []) {
            const propertyName = getStaticPropertyKeyName(property, { allowComputedString: true });
            if (
              propertyName === null ||
              !REACT_ROUTER_V8_REMOVED_FUTURE_FLAG_NAMES.has(propertyName)
            ) {
              continue;
            }
            context.report({
              node: property,
              message: `future.${propertyName} is removed in React Router v8.`,
            });
          }
        },
      };
    },
  }),
);
