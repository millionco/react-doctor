import { SEQUENTIAL_AWAIT_THRESHOLD_FOR_LOADER } from "../../constants/tanstack.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getRouteOptionsObject } from "./utils/get-route-options-object.js";
import { getPropertyKeyName } from "./utils/get-property-key-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const hasTopLevelAwait = (statement: EsTreeNode): boolean => {
  if (isNodeOfType(statement, "VariableDeclaration")) {
    return statement.declarations?.some((declarator) =>
      isNodeOfType(declarator.init, "AwaitExpression"),
    );
  }
  if (isNodeOfType(statement, "ExpressionStatement")) {
    return (
      isNodeOfType(statement.expression, "AwaitExpression") ||
      (isNodeOfType(statement.expression, "AssignmentExpression") &&
        isNodeOfType(statement.expression.right, "AwaitExpression"))
    );
  }
  if (isNodeOfType(statement, "ReturnStatement")) {
    return isNodeOfType(statement.argument, "AwaitExpression");
  }
  if (isNodeOfType(statement, "ForOfStatement") && statement.await) {
    return true;
  }
  return false;
};

export const tanstackStartLoaderParallelFetch = defineRule<Rule>({
  id: "tanstack-start-loader-parallel-fetch",
  requires: ["tanstack-start"],
  framework: "tanstack-start",
  severity: "warn",
  category: "Performance",
  recommendation:
    "Use `const [a, b] = await Promise.all([fetchA(), fetchB()])` to avoid request waterfalls in route loaders",
  examples: [
    {
      before:
        "loader: async () => {\n  const user = await getUser();\n  const posts = await getPosts();\n  return { user, posts };\n}",
      after:
        "loader: async () => {\n  const [user, posts] = await Promise.all([getUser(), getPosts()]);\n  return { user, posts };\n}",
    },
  ],
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

        let sequentialAwaitCount = 0;
        for (const statement of functionBody.body ?? []) {
          if (hasTopLevelAwait(statement)) {
            sequentialAwaitCount++;
          }

          if (sequentialAwaitCount >= SEQUENTIAL_AWAIT_THRESHOLD_FOR_LOADER) {
            context.report({
              node: property,
              message:
                "Multiple sequential awaits in loader — use Promise.all() to fetch data in parallel and avoid waterfalls",
            });
            break;
          }
        }
      }
    },
  }),
});
