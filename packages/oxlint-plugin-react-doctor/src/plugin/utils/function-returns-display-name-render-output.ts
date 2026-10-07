import type { ControlFlowAnalysis } from "../semantic/control-flow-graph.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isRenderPreservingCallArgumentFunction } from "./function-contains-react-render-output.js";
import { createFunctionReturnMatcher } from "./function-returns-matching-expression.js";
import { isCreateElementCall } from "./is-create-element-call.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

const isDisplayNameRenderValue = (
  expression: EsTreeNode,
  matchesExpression: (expression: EsTreeNode) => boolean,
  matchesFunction: (functionNode: EsTreeNode) => boolean,
  scopes: ScopeAnalysis,
): boolean => {
  const candidate = stripParenExpression(expression);
  if (
    candidate.type === "JSXElement" ||
    candidate.type === "JSXFragment" ||
    isCreateElementCall(candidate)
  ) {
    return true;
  }
  if (isNodeOfType(candidate, "ArrayExpression")) {
    return candidate.elements.some((element) => element && matchesExpression(element));
  }
  if (isNodeOfType(candidate, "CallExpression")) {
    return candidate.arguments.some(
      (argument) =>
        isRenderPreservingCallArgumentFunction(argument, scopes) && matchesFunction(argument),
    );
  }
  if (isNodeOfType(candidate, "SequenceExpression")) {
    const lastExpression = candidate.expressions.at(-1);
    return Boolean(lastExpression && matchesExpression(lastExpression));
  }
  return false;
};

export const functionReturnsDisplayNameRenderOutput = (
  functionNode: EsTreeNode,
  scopes: ScopeAnalysis,
  controlFlow: ControlFlowAnalysis,
): boolean => {
  const matcher = createFunctionReturnMatcher(
    scopes,
    (expression) =>
      isDisplayNameRenderValue(
        expression,
        matcher.expressionMatches,
        matcher.functionMatches,
        scopes,
      ),
    controlFlow,
  );
  return matcher.functionMatches(functionNode);
};
