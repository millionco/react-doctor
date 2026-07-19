import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { walkAst } from "../../utils/walk-ast.js";
import { isR3fApiCall } from "./utils/is-r3f-api-call.js";
import { resolveLocalReactCallback } from "./utils/resolve-local-react-callback.js";
import { resolveR3fFreshValue } from "./utils/resolve-r3f-fresh-value.js";

const findFreshSelectorReturn = (selector: EsTreeNode, context: RuleContext): EsTreeNode | null => {
  if (!isFunctionLike(selector)) return null;
  if (!isNodeOfType(selector.body, "BlockStatement")) {
    const freshKind = resolveR3fFreshValue(selector.body, context.scopes);
    return freshKind === "object" || freshKind === "array" ? selector.body : null;
  }
  let freshReturn: EsTreeNode | null = null;
  walkAst(selector.body, (candidate) => {
    if (candidate !== selector.body && isFunctionLike(candidate)) return false;
    if (
      !freshReturn &&
      isNodeOfType(candidate, "ReturnStatement") &&
      candidate.argument &&
      ["object", "array"].includes(resolveR3fFreshValue(candidate.argument, context.scopes) ?? "")
    ) {
      freshReturn = candidate.argument;
    }
  });
  return freshReturn;
};

export const r3fNoFreshUseThreeSelector = defineRule({
  id: "r3f-no-fresh-use-three-selector",
  title: "Fresh useThree selector result",
  severity: "warn",
  requires: ["r3f:6"],
  recommendation:
    "Select one stable store field at a time, or provide an equality function when returning an object or array from useThree",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isR3fApiCall(node, "useThree", context.scopes) || node.arguments.length > 1) return;
      const selectorArgument = node.arguments[0];
      if (!selectorArgument || isNodeOfType(selectorArgument, "SpreadElement")) return;
      const selector = resolveLocalReactCallback(selectorArgument, context.scopes);
      if (!selector) return;
      const freshReturn = findFreshSelectorReturn(selector, context);
      if (!freshReturn) return;
      context.report({
        node: freshReturn,
        message:
          "This selector creates a new object or array whenever the R3F store updates, defeating reference equality and causing avoidable React renders. Select a stable field or provide equality",
      });
    },
  }),
});
