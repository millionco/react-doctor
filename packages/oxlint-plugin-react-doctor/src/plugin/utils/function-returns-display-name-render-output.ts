import type { ControlFlowAnalysis } from "../semantic/control-flow-graph.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { functionReturnsMatchingExpression } from "./function-returns-matching-expression.js";
import { isCreateElementCall } from "./is-create-element-call.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

const isDisplayNameRenderValue = (expression: EsTreeNode): boolean => {
  const candidate = stripParenExpression(expression);
  if (
    candidate.type === "JSXElement" ||
    candidate.type === "JSXFragment" ||
    isCreateElementCall(candidate)
  ) {
    return true;
  }
  if (isNodeOfType(candidate, "ArrayExpression")) {
    return candidate.elements.some((element) => element && isDisplayNameRenderValue(element));
  }
  if (isNodeOfType(candidate, "ConditionalExpression")) {
    return (
      isDisplayNameRenderValue(candidate.consequent) ||
      isDisplayNameRenderValue(candidate.alternate)
    );
  }
  if (isNodeOfType(candidate, "LogicalExpression")) {
    return isDisplayNameRenderValue(candidate.left) || isDisplayNameRenderValue(candidate.right);
  }
  if (isNodeOfType(candidate, "SequenceExpression")) {
    const lastExpression = candidate.expressions.at(-1);
    return Boolean(lastExpression && isDisplayNameRenderValue(lastExpression));
  }
  return false;
};

export const functionReturnsDisplayNameRenderOutput = (
  functionNode: EsTreeNode,
  scopes: ScopeAnalysis,
  controlFlow: ControlFlowAnalysis,
): boolean =>
  functionReturnsMatchingExpression(functionNode, scopes, isDisplayNameRenderValue, controlFlow);
