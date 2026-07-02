import { defineRule } from "../../utils/define-rule.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { walkServerFnChain } from "./utils/walk-server-fn-chain.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const objectPatternHasDataProperty = (pattern: EsTreeNodeOfType<"ObjectPattern">): boolean =>
  Boolean(
    pattern.properties?.some(
      (property) =>
        isNodeOfType(property, "Property") &&
        isNodeOfType(property.key, "Identifier") &&
        property.key.name === "data",
    ),
  );

export const tanstackStartServerFnValidateInput = defineRule({
  id: "tanstack-start-server-fn-validate-input",
  title: "Server function without input validation",
  tags: ["test-noise"],
  requires: ["tanstack-start"],
  severity: "warn",
  recommendation:
    "Add `.validator(schema)` before `.handler()`. This data crosses the network and must be validated at runtime.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isNodeOfType(node.callee, "MemberExpression")) return;
      if (!isNodeOfType(node.callee.property, "Identifier")) return;
      if (node.callee.property.name !== "handler") return;

      const chainInfo = walkServerFnChain(node);
      if (!chainInfo.isServerFnChain) return;

      const handlerFunction = node.arguments?.[0];
      if (!handlerFunction) return;
      if (
        !isNodeOfType(handlerFunction, "ArrowFunctionExpression") &&
        !isNodeOfType(handlerFunction, "FunctionExpression")
      )
        return;

      // `.data` is only the network INPUT when it binds to the handler's
      // FIRST parameter. A bare `.data`/`{ data }` anywhere else in the body
      // is unrelated — e.g. Supabase's `const { data } = await db.select()`
      // destructures its own `{ data, error }` result, not handler input.
      const firstParameter = handlerFunction.params?.[0];
      if (!firstParameter) return;

      let accessesData = false;
      if (isNodeOfType(firstParameter, "ObjectPattern")) {
        // `.handler(({ data }) => …)` — the param itself reads input.data.
        accessesData = objectPatternHasDataProperty(firstParameter);
      } else if (isNodeOfType(firstParameter, "Identifier")) {
        // `.handler((ctx) => …)` — input access is `ctx.data` member access
        // OR a body destructure rooted at the param: `const { data } = ctx`.
        const parameterName = firstParameter.name;
        walkAst(handlerFunction, (child: EsTreeNode) => {
          if (
            isNodeOfType(child, "MemberExpression") &&
            isNodeOfType(child.object, "Identifier") &&
            child.object.name === parameterName &&
            isNodeOfType(child.property, "Identifier") &&
            child.property.name === "data"
          ) {
            accessesData = true;
          }
          if (
            isNodeOfType(child, "VariableDeclarator") &&
            isNodeOfType(child.init, "Identifier") &&
            child.init.name === parameterName &&
            isNodeOfType(child.id, "ObjectPattern") &&
            objectPatternHasDataProperty(child.id)
          ) {
            accessesData = true;
          }
        });
      }

      if (accessesData && !chainInfo.hasInputValidation) {
        context.report({
          node,
          message:
            "This server function reads network data with no validator(), so anyone can send unvalidated input.",
        });
      }
    },
  }),
});
