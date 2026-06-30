import { areExpressionsStructurallyEqual } from "../../utils/are-expressions-structurally-equal.js";
import { collectEarlierAndGuardOperands } from "../../utils/collect-earlier-and-guard-operands.js";
import { defineRule } from "../../utils/define-rule.js";
import { isInlineFunctionExpression } from "../../utils/is-inline-function-expression.js";
import { isMemberProperty } from "../../utils/is-member-property.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
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

const LENGTH_EQUALITY_OPERATORS: ReadonlySet<string> = new Set(["===", "=="]);
const LENGTH_MISMATCH_OPERATORS: ReadonlySet<string> = new Set(["!==", "!="]);

// `<a>.length <op> <b>.length` (in either operand order) comparing the
// two arrays under test, for the given operator set.
const isLengthComparison = (
  candidate: EsTreeNode,
  receiverArray: EsTreeNode,
  indexedArray: EsTreeNode,
  operators: ReadonlySet<string>,
): boolean => {
  const binaryGuard = unwrapChainExpression(candidate);
  if (!isNodeOfType(binaryGuard, "BinaryExpression")) return false;
  if (!operators.has(binaryGuard.operator)) return false;
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

const isMatchingLengthEqualityGuard = (
  guardOperand: EsTreeNode,
  receiverArray: EsTreeNode,
  indexedArray: EsTreeNode,
): boolean =>
  isLengthComparison(guardOperand, receiverArray, indexedArray, LENGTH_EQUALITY_OPERATORS);

// A statement that ends the current control-flow path (so a guarded
// `if (mismatch) return/throw` makes the comparison below unreachable on
// the mismatch path). Handles both `if (…) return x;` and a single-stmt
// `if (…) { return x; }` block.
const doesStatementTerminate = (statement: EsTreeNode | null | undefined): boolean => {
  if (!statement) return false;
  if (isNodeOfType(statement, "ReturnStatement") || isNodeOfType(statement, "ThrowStatement")) {
    return true;
  }
  if (isNodeOfType(statement, "BlockStatement")) {
    const statements = statement.body ?? [];
    return statements.some((inner) => doesStatementTerminate(inner as EsTreeNode));
  }
  return false;
};

// Find the statement-level ancestor of `node` (the node whose parent is a
// BlockStatement / Program) so we can inspect its preceding siblings.
const findEnclosingStatement = (
  node: EsTreeNode,
): { block: EsTreeNode; statement: EsTreeNode } | null => {
  let current: EsTreeNode | null | undefined = node;
  while (current?.parent) {
    const parent: EsTreeNode = current.parent;
    if (isNodeOfType(parent, "BlockStatement") || isNodeOfType(parent, "Program")) {
      return { block: parent, statement: current };
    }
    current = parent;
  }
  return null;
};

// `if (a.length !== b.length) return false;` written as an early-return
// guard in a PRECEDING statement (not an `&&` operand in the same
// expression) already short-circuits the comparison — recognize it.
const hasPrecedingLengthMismatchGuard = (
  callNode: EsTreeNode,
  receiverArray: EsTreeNode,
  indexedArray: EsTreeNode,
): boolean => {
  const enclosing = findEnclosingStatement(callNode);
  if (!enclosing) return false;
  const statements = (enclosing.block as { body?: EsTreeNode[] }).body ?? [];
  const statementIndex = statements.indexOf(enclosing.statement);
  if (statementIndex <= 0) return false;
  for (let index = 0; index < statementIndex; index += 1) {
    const statement = statements[index];
    if (!isNodeOfType(statement, "IfStatement")) continue;
    if (
      isLengthComparison(
        statement.test as EsTreeNode,
        receiverArray,
        indexedArray,
        LENGTH_MISMATCH_OPERATORS,
      ) &&
      doesStatementTerminate(statement.consequent as EsTreeNode)
    ) {
      return true;
    }
  }
  return false;
};

// HACK: when comparing two arrays element-by-element via .every / .some /
// .reduce against another array, a length mismatch is the cheapest possible
// shortcut. e.g. `a.length === b.length && a.every((x, i) => x === b[i])`
// runs the every-loop only when lengths match.
export const jsLengthCheckFirst = defineRule({
  id: "js-length-check-first",
  title: "Array compare without length check",
  tags: ["test-noise"],
  severity: "warn",
  recommendation:
    "Check `a.length === b.length && a.every((x, i) => x === b[i])` so arrays of different sizes stop right away",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isNodeOfType(node.callee, "MemberExpression")) return;
      if (!isNodeOfType(node.callee.property, "Identifier")) return;
      if (node.callee.property.name !== "every") return;

      const callback = node.arguments?.[0];
      if (!isInlineFunctionExpression(callback)) {
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
      if (hasPrecedingLengthMismatchGuard(node, receiverArrayObject, indexedArrayObject)) return;

      context.report({
        node,
        message:
          "This is slow because .every() compares two arrays item by item, so check `a.length === b.length` first to bail out immediately when sizes differ",
      });
    },
  }),
});
