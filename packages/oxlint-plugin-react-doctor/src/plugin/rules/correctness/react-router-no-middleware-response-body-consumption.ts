import { REACT_ROUTER_RESPONSE_BODY_READER_NAMES } from "../../constants/react-router.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { getReactRouterMiddlewareNextSymbol } from "../../utils/get-react-router-middleware-next-symbol.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { wrapReactRouterRule } from "../../utils/wrap-react-router-rule.js";

export const reactRouterNoMiddlewareResponseBodyConsumption = wrapReactRouterRule(
  defineRule({
    id: "react-router-no-middleware-response-body-consumption",
    title: "Middleware consumes the outgoing response body",
    tags: ["test-noise"],
    requires: ["react-router:7.9", "react-router-framework"],
    severity: "warn",
    recommendation:
      "Inspect or change response headers and status without consuming the body returned by next().",
    create: (context: RuleContext) => {
      const inspectFunction = (functionNode: EsTreeNode): void => {
        if (!isFunctionLike(functionNode)) return;
        const nextSymbol = getReactRouterMiddlewareNextSymbol(context, functionNode);
        if (nextSymbol === null) return;
        for (const nextReference of nextSymbol.references) {
          const callExpression = nextReference.identifier.parent;
          if (!isNodeOfType(callExpression, "CallExpression")) continue;
          if (callExpression.callee !== nextReference.identifier) continue;
          const awaitedExpression = callExpression.parent;
          if (!isNodeOfType(awaitedExpression, "AwaitExpression")) continue;
          const declarator = awaitedExpression.parent;
          if (!isNodeOfType(declarator, "VariableDeclarator")) continue;
          if (!isNodeOfType(declarator.id, "Identifier")) continue;
          const responseSymbol = context.scopes.symbolFor(declarator.id);
          if (responseSymbol === null) continue;
          for (const responseReference of responseSymbol.references) {
            const memberExpression = responseReference.identifier.parent;
            if (!isNodeOfType(memberExpression, "MemberExpression")) continue;
            const methodName = getStaticPropertyKeyName(memberExpression, {
              allowComputedString: true,
            });
            if (methodName === null || !REACT_ROUTER_RESPONSE_BODY_READER_NAMES.has(methodName)) {
              continue;
            }
            if (
              !isNodeOfType(memberExpression.parent, "CallExpression") ||
              memberExpression.parent.callee !== memberExpression
            ) {
              continue;
            }
            context.report({
              node: memberExpression.parent,
              message: `${declarator.id.name}.${methodName}() consumes the Response body returned by next().`,
            });
          }
        }
      };
      return {
        ArrowFunctionExpression: inspectFunction,
        FunctionDeclaration: inspectFunction,
        FunctionExpression: inspectFunction,
      };
    },
  }),
);
