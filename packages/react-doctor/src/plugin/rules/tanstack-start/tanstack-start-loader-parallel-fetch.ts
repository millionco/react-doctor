import { SEQUENTIAL_AWAIT_THRESHOLD_FOR_LOADER } from "../../constants.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getRouteOptionsObject } from "./utils/get-route-options-object.js";
import { getPropertyKeyName } from "./utils/get-property-key-name.js";

const hasTopLevelAwait = (statement: EsTreeNode): boolean => {
  if (statement.type === "VariableDeclaration") {
    return statement.declarations?.some(
      (declarator: EsTreeNode) => declarator.init?.type === "AwaitExpression",
    );
  }
  if (statement.type === "ExpressionStatement") {
    return (
      statement.expression?.type === "AwaitExpression" ||
      (statement.expression?.type === "AssignmentExpression" &&
        statement.expression.right?.type === "AwaitExpression")
    );
  }
  if (statement.type === "ReturnStatement") {
    return statement.argument?.type === "AwaitExpression";
  }
  if (statement.type === "ForOfStatement" && statement.await) {
    return true;
  }
  return false;
};

export const tanstackStartLoaderParallelFetch = defineRule<Rule>({
  recommendation:
    "Use `const [a, b] = await Promise.all([fetchA(), fetchB()])` to avoid request waterfalls in route loaders",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNode) {
      const optionsObject = getRouteOptionsObject(node);
      if (!optionsObject) return;

      const properties = optionsObject.properties ?? [];
      for (const property of properties) {
        const keyName = getPropertyKeyName(property);
        if (keyName !== "loader") continue;

        const loaderValue = property.value;
        if (
          !loaderValue ||
          (loaderValue.type !== "ArrowFunctionExpression" &&
            loaderValue.type !== "FunctionExpression")
        )
          continue;

        const functionBody = loaderValue.body;
        if (!functionBody || functionBody.type !== "BlockStatement") continue;

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
