import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { isR3fApiCall } from "./utils/is-r3f-api-call.js";

const resolvesToArrayExpression = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number> = new Set(),
): boolean => {
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "ArrayExpression")) return true;
  if (!isNodeOfType(candidate, "Identifier")) return false;
  const symbol = scopes.symbolFor(candidate);
  if (
    symbol?.kind !== "const" ||
    !symbol.initializer ||
    visitedSymbolIds.has(symbol.id) ||
    !isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
    symbol.declarationNode.id !== symbol.bindingIdentifier
  ) {
    return false;
  }
  visitedSymbolIds.add(symbol.id);
  return resolvesToArrayExpression(symbol.initializer, scopes, visitedSymbolIds);
};

export const r3fNoUseFrameDependencyArray = defineRule({
  id: "r3f-no-use-frame-dependency-array",
  title: "Dependency array passed to useFrame",
  category: "Correctness",
  severity: "warn",
  requires: ["r3f:3"],
  recommendation:
    "Remove the dependency array. Pass a numeric render priority on R3F v9, or supported scheduling options on R3F v10",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isR3fApiCall(node, "useFrame", context.scopes)) return;
      const schedulingArgument = node.arguments[1];
      if (
        !schedulingArgument ||
        isNodeOfType(schedulingArgument, "SpreadElement") ||
        !resolvesToArrayExpression(schedulingArgument, context.scopes)
      ) {
        return;
      }
      context.report({
        node: schedulingArgument,
        message:
          "useFrame does not use a React dependency array. Its second argument controls R3F frame scheduling, so this array can change render ordering or be ignored instead of controlling callback updates",
      });
    },
  }),
});
