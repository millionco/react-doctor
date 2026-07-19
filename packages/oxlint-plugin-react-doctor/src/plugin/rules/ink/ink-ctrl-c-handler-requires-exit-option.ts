import { MINIMUM_INK_VERSIONS } from "../../constants/ink.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { flattenLogicalAndChain } from "../../utils/flatten-logical-and-chain.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveInkApiName } from "../../utils/resolve-ink-api-name.js";
import {
  collectInkRenderCalls,
  getInkRenderBooleanOption,
  resolveInkRenderCallsForNode,
} from "../../utils/resolve-ink-render-calls.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";

const handlesCtrlC = (handler: EsTreeNode, context: RuleContext): boolean => {
  if (
    (!isNodeOfType(handler, "ArrowFunctionExpression") &&
      !isNodeOfType(handler, "FunctionExpression")) ||
    !isNodeOfType(handler.params[0], "Identifier") ||
    !isNodeOfType(handler.params[1], "Identifier")
  ) {
    return false;
  }
  const inputSymbolId = context.scopes.symbolFor(handler.params[0])?.id;
  const keySymbolId = context.scopes.symbolFor(handler.params[1])?.id;
  if (inputSymbolId === undefined || keySymbolId === undefined) return false;

  let hasCtrlCCondition = false;
  walkAst(handler.body, (descendantNode) => {
    if (!isNodeOfType(descendantNode, "LogicalExpression") || descendantNode.operator !== "&&") {
      return;
    }
    const operands = flattenLogicalAndChain(descendantNode);
    const hasCtrlOperand = operands.some((operand) => {
      const candidate = stripParenExpression(operand);
      if (
        !isNodeOfType(candidate, "MemberExpression") ||
        getStaticPropertyName(candidate) !== "ctrl"
      ) {
        return false;
      }
      const receiver = stripParenExpression(candidate.object);
      return (
        isNodeOfType(receiver, "Identifier") &&
        context.scopes.symbolFor(receiver)?.id === keySymbolId
      );
    });
    const hasCOperand = operands.some((operand) => {
      const candidate = stripParenExpression(operand);
      if (
        !isNodeOfType(candidate, "BinaryExpression") ||
        (candidate.operator !== "===" && candidate.operator !== "==")
      ) {
        return false;
      }
      const left = stripParenExpression(candidate.left);
      const right = stripParenExpression(candidate.right);
      return (
        (isNodeOfType(left, "Identifier") &&
          context.scopes.symbolFor(left)?.id === inputSymbolId &&
          isNodeOfType(right, "Literal") &&
          right.value === "c") ||
        (isNodeOfType(right, "Identifier") &&
          context.scopes.symbolFor(right)?.id === inputSymbolId &&
          isNodeOfType(left, "Literal") &&
          left.value === "c")
      );
    });
    if (hasCtrlOperand && hasCOperand) {
      hasCtrlCCondition = true;
      return false;
    }
  });
  return hasCtrlCCondition;
};

export const inkCtrlCHandlerRequiresExitOption = defineRule({
  id: "ink-ctrl-c-handler-requires-exit-option",
  title: "Ctrl-C handler is unreachable",
  severity: "error",
  minimumInkVersion: MINIMUM_INK_VERSIONS.base,
  recommendation:
    "Pass `{exitOnCtrlC: false}` to `render()` before handling Ctrl-C with `useInput`.",
  create: (context) => ({
    Program(node: EsTreeNodeOfType<"Program">) {
      const renderCalls = collectInkRenderCalls(node, context);
      walkAst(node, (descendantNode) => {
        if (
          !isNodeOfType(descendantNode, "CallExpression") ||
          resolveInkApiName(descendantNode.callee, context.scopes) !== "useInput"
        ) {
          return;
        }
        const handler = descendantNode.arguments[0];
        if (!handler || !handlesCtrlC(handler, context)) return;
        const relatedRenderCalls = resolveInkRenderCallsForNode(
          descendantNode,
          renderCalls,
          context,
        );
        if (
          relatedRenderCalls.length === 0 ||
          !relatedRenderCalls.some(
            (renderCall) =>
              getInkRenderBooleanOption(renderCall.node, "exitOnCtrlC", true) === true,
          )
        ) {
          return;
        }
        context.report({
          node: descendantNode,
          message:
            "Ink consumes Ctrl-C before `useInput` unless `render()` disables `exitOnCtrlC`.",
        });
      });
    },
  }),
});
