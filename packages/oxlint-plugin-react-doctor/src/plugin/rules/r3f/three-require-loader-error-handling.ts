import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveConstIdentifierAlias } from "../../utils/resolve-const-identifier-alias.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { getThreeConstructorName } from "./utils/get-three-constructor-name.js";

const hasExplicitErrorCallback = (argument: EsTreeNode | undefined): boolean => {
  if (!argument || isNodeOfType(argument, "SpreadElement")) return false;
  const candidate = stripParenExpression(argument);
  if (isNodeOfType(candidate, "Literal") && candidate.value === null) return false;
  return !(isNodeOfType(candidate, "Identifier") && candidate.name === "undefined");
};

const isUnobservedPromiseCall = (node: EsTreeNodeOfType<"CallExpression">): boolean => {
  const parent = node.parent;
  if (isNodeOfType(parent, "ExpressionStatement")) return true;
  return Boolean(
    isNodeOfType(parent, "UnaryExpression") &&
    parent.operator === "void" &&
    isNodeOfType(parent.parent, "ExpressionStatement"),
  );
};

const hasExplicitLoadingManager = (expression: EsTreeNode, context: RuleContext): boolean => {
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "NewExpression")) return candidate.arguments.length > 0;
  if (!isNodeOfType(candidate, "Identifier")) return false;
  const symbol = resolveConstIdentifierAlias(candidate, context.scopes);
  if (symbol?.kind !== "const" || !symbol.initializer) return false;
  const initializer = stripParenExpression(symbol.initializer);
  return isNodeOfType(initializer, "NewExpression") && initializer.arguments.length > 0;
};

export const threeRequireLoaderErrorHandling = defineRule({
  id: "three-require-loader-error-handling",
  title: "Three.js asset load has no local error path",
  category: "Correctness",
  severity: "warn",
  recommendation:
    "Provide Loader.load with an onError callback, or await, return, or otherwise observe Loader.loadAsync rejections",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isNodeOfType(node.callee, "MemberExpression")) return;
      const methodName = getStaticPropertyName(node.callee);
      const constructorName = getThreeConstructorName(node.callee.object, context.scopes);
      if (!constructorName?.endsWith("Loader")) return;
      if (
        methodName === "load" &&
        !hasExplicitErrorCallback(node.arguments[3]) &&
        !hasExplicitLoadingManager(node.callee.object, context)
      ) {
        context.report({
          node,
          message:
            "This Loader.load call omits its onError callback. Surface failed model or texture requests through an explicit error path",
        });
        return;
      }
      if (methodName !== "loadAsync" || !isUnobservedPromiseCall(node)) return;
      context.report({
        node,
        message:
          "This Loader.loadAsync promise is discarded, so a failed asset request has no observable error path. Await, return, or handle the promise",
      });
    },
  }),
});
