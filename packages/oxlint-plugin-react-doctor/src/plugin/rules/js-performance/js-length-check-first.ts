import { areExpressionsStructurallyEqual } from "../../utils/are-expressions-structurally-equal.js";
import { collectEarlierAndGuardOperands } from "../../utils/collect-earlier-and-guard-operands.js";
import { defineRule } from "../../utils/define-rule.js";
import { isMemberProperty } from "../../utils/is-member-property.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const findIndexedArrayObject = (
  callbackBody: EsTreeNode,
  indexParameterName: string,
): EsTreeNode | null => {
  let indexedArrayObject: EsTreeNode | null = null;
  walkAst(callbackBody, (child: EsTreeNode) => {
    if (indexedArrayObject) return;
    if (
      isNodeOfType(child, "MemberExpression") &&
      child.computed &&
      isNodeOfType(child.property, "Identifier") &&
      child.property.name === indexParameterName
    ) {
      indexedArrayObject = child.object;
    }
  });
  return indexedArrayObject;
};

const unwrapChainExpression = (node: EsTreeNode): EsTreeNode =>
  isNodeOfType(node, "ChainExpression") ? node.expression : node;

const isMatchingLengthEqualityGuard = (
  guardOperand: EsTreeNode,
  receiverArray: EsTreeNode,
  indexedArray: EsTreeNode,
): boolean => {
  const binaryGuard = unwrapChainExpression(guardOperand);
  if (!isNodeOfType(binaryGuard, "BinaryExpression")) return false;
  if (binaryGuard.operator !== "===" && binaryGuard.operator !== "==") return false;
  const leftSide = unwrapChainExpression(binaryGuard.left);
  const rightSide = unwrapChainExpression(binaryGuard.right);
  if (!isMemberProperty(leftSide, "length")) return false;
  if (!isMemberProperty(rightSide, "length")) return false;
  const leftLengthObject = unwrapChainExpression(leftSide.object);
  const rightLengthObject = unwrapChainExpression(rightSide.object);
  const normalizedReceiver = unwrapChainExpression(receiverArray);
  const normalizedIndexed = unwrapChainExpression(indexedArray);
  const matchesReceiverThenIndexed =
    areExpressionsStructurallyEqual(leftLengthObject, normalizedReceiver) &&
    areExpressionsStructurallyEqual(rightLengthObject, normalizedIndexed);
  const matchesIndexedThenReceiver =
    areExpressionsStructurallyEqual(leftLengthObject, normalizedIndexed) &&
    areExpressionsStructurallyEqual(rightLengthObject, normalizedReceiver);
  return matchesReceiverThenIndexed || matchesIndexedThenReceiver;
};

// HACK: when comparing two arrays element-by-element via .every / .some /
// .reduce against another array, a length mismatch is the cheapest possible
// shortcut. e.g. `a.length === b.length && a.every((x, i) => x === b[i])`
// runs the every-loop only when lengths match.
export const jsLengthCheckFirst = defineRule<Rule>({
  id: "js-length-check-first",
  severity: "warn",
  recommendation:
    "Short-circuit with `a.length === b.length && a.every((x, i) => x === b[i])` — unequal-length arrays exit immediately",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isNodeOfType(node.callee, "MemberExpression")) return;
      if (!isNodeOfType(node.callee.property, "Identifier")) return;
      if (node.callee.property.name !== "every") return;

      const callback = node.arguments?.[0];
      if (
        !isNodeOfType(callback, "ArrowFunctionExpression") &&
        !isNodeOfType(callback, "FunctionExpression")
      ) {
        return;
      }
      const callbackParameters = callback.params ?? [];
      if (callbackParameters.length < 2) return; // need (item, index, ...) to address other array
      const indexParameter = callbackParameters[1];
      if (!isNodeOfType(indexParameter, "Identifier")) return;

      const indexedArrayObject = findIndexedArrayObject(callback.body, indexParameter.name);
      if (!indexedArrayObject) return;

      const receiverArrayObject = node.callee.object;
      const earlierGuardOperands = collectEarlierAndGuardOperands(node);
      const isAlreadyLengthGuarded = earlierGuardOperands.some((guardOperand) =>
        isMatchingLengthEqualityGuard(guardOperand, receiverArrayObject, indexedArrayObject),
      );
      if (isAlreadyLengthGuarded) return;

      context.report({
        node,
        message:
          ".every() over an array compared to another array — short-circuit with `a.length === b.length && a.every(...)` so unequal-length arrays exit immediately",
      });
    },
  }),
});
