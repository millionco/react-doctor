import { SEQUENTIAL_AWAIT_THRESHOLD_FOR_LOADER } from "../../constants/tanstack.js";
import { defineRule } from "../../utils/define-rule.js";
import { findSequentialIndependentAwait } from "../../utils/find-sequential-independent-await.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getRouteOptionsObject } from "./utils/get-route-options-object.js";
import { getPropertyKeyName } from "./utils/get-property-key-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const tanstackStartLoaderParallelFetch = defineRule({
  id: "tanstack-start-loader-parallel-fetch",
  title: "Sequential awaits in loader",
  tags: ["test-noise"],
  requires: ["tanstack-start"],
  severity: "warn",
  category: "Performance",
  recommendation:
    "Use `const [a, b] = await Promise.all([fetchA(), fetchB()])` to avoid request waterfalls in route loaders",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      const optionsObject = getRouteOptionsObject(node);
      if (!optionsObject) return;

      const properties = optionsObject.properties ?? [];
      for (const property of properties) {
        const keyName = getPropertyKeyName(property);
        if (keyName !== "loader") continue;
        if (!isNodeOfType(property, "Property")) continue;

        const loaderValue = property.value;
        if (
          !loaderValue ||
          (!isNodeOfType(loaderValue, "ArrowFunctionExpression") &&
            !isNodeOfType(loaderValue, "FunctionExpression"))
        )
          continue;

        const functionBody = loaderValue.body;
        if (!functionBody || !isNodeOfType(functionBody, "BlockStatement")) continue;

        if (
          findSequentialIndependentAwait(functionBody, SEQUENTIAL_AWAIT_THRESHOLD_FOR_LOADER) ===
          null
        ) {
          continue;
        }
        context.report({
          node: property,
          message:
            "Sequential awaits in this loader create a request waterfall that slows the route.",
        });
      }
    },
  }),
});
