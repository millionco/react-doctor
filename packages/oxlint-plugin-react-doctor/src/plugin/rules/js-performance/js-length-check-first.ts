import { areExpressionsStructurallyEqual } from "../../utils/are-expressions-structurally-equal.js";
import { collectEarlierAndGuardOperands } from "../../utils/collect-earlier-and-guard-operands.js";
import { collectPatternNames } from "../../utils/collect-pattern-names.js";
import { defineRule } from "../../utils/define-rule.js";
import { flattenLogicalAndChain } from "../../utils/flatten-logical-and-chain.js";
import { getRootIdentifierName } from "../../utils/get-root-identifier-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
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
// Inequality AND relational operators: a deliberate `a.length > b.length`
// guard (partial-input validation) proves the author already thought about
// diverging lengths, so the "check length first" advice is noise there.
const LENGTH_MISMATCH_OPERATORS: ReadonlySet<string> = new Set(["!==", "!=", ">", "<", ">=", "<="]);

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

// Falling through `if (x || y || …) return` means EVERY operand was falsy,
// so a length-mismatch operand among them guarantees the lengths matched.
const flattenLogicalOrChain = (node: EsTreeNode): EsTreeNode[] => {
  if (isNodeOfType(node, "LogicalExpression") && node.operator === "||") {
    return [...flattenLogicalOrChain(node.left), ...flattenLogicalOrChain(node.right)];
  }
  return [node];
};

// A write to either compared array between the guard and the comparison
// makes the guard stale — the lengths it checked no longer describe the
// values being compared.
const isEitherArrayReassignedIn = (
  statements: EsTreeNode[],
  fromIndex: number,
  toIndex: number,
  receiverArray: EsTreeNode,
  indexedArray: EsTreeNode,
): boolean => {
  for (let index = fromIndex; index < toIndex; index += 1) {
    let didFindReassignment = false;
    walkAst(statements[index], (child: EsTreeNode) => {
      if (didFindReassignment) return false;
      const writeTarget = isNodeOfType(child, "AssignmentExpression")
        ? child.left
        : isNodeOfType(child, "UpdateExpression")
          ? child.argument
          : null;
      if (!writeTarget) return;
      if (
        areExpressionsStructurallyEqual(writeTarget, receiverArray) ||
        areExpressionsStructurallyEqual(writeTarget, indexedArray)
      ) {
        didFindReassignment = true;
      }
    });
    if (didFindReassignment) return true;
  }
  return false;
};

// `if (a.length !== b.length) return false;` written as an early-return
// guard in a PRECEDING statement (in this block or any enclosing block),
// or an ENCLOSING `if (a.length === b.length) { … }` equality gate,
// already short-circuits the comparison — recognize both. The guard is
// invalidated when either array is reassigned between guard and
// comparison, or when a nested function's parameter shadows a compared
// array name (the guarded binding is not the one being compared).
const hasDominatingLengthGuard = (
  callNode: EsTreeNode,
  receiverArray: EsTreeNode,
  indexedArray: EsTreeNode,
): boolean => {
  const comparedRootNames = [
    getRootIdentifierName(receiverArray),
    getRootIdentifierName(indexedArray),
  ].filter((rootName): rootName is string => Boolean(rootName));
  let child: EsTreeNode = callNode;
  let ancestor: EsTreeNode | null | undefined = callNode.parent;
  while (ancestor) {
    if (isFunctionLike(ancestor)) {
      const parameterNames = new Set<string>();
      for (const parameter of ancestor.params ?? []) {
        collectPatternNames(parameter, parameterNames);
      }
      if (comparedRootNames.some((rootName) => parameterNames.has(rootName))) return false;
    }
    if (isNodeOfType(ancestor, "IfStatement") && ancestor.consequent === child) {
      const equalityGateHolds = flattenLogicalAndChain(ancestor.test).some((guardOperand) =>
        isLengthComparison(guardOperand, receiverArray, indexedArray, LENGTH_EQUALITY_OPERATORS),
      );
      if (equalityGateHolds) return true;
    }
    if (isNodeOfType(ancestor, "BlockStatement") || isNodeOfType(ancestor, "Program")) {
      const statements: EsTreeNode[] = ancestor.body ?? [];
      const statementIndex = statements.indexOf(child);
      for (let guardIndex = 0; guardIndex < statementIndex; guardIndex += 1) {
        const statement = statements[guardIndex];
        if (!isNodeOfType(statement, "IfStatement")) continue;
        const mismatchGuardHolds = flattenLogicalOrChain(statement.test).some((guardOperand) =>
          isLengthComparison(guardOperand, receiverArray, indexedArray, LENGTH_MISMATCH_OPERATORS),
        );
        if (!mismatchGuardHolds) continue;
        if (!doesStatementTerminate(statement.consequent as EsTreeNode)) continue;
        if (
          isEitherArrayReassignedIn(
            statements,
            guardIndex + 1,
            statementIndex,
            receiverArray,
            indexedArray,
          )
        ) {
          continue;
        }
        return true;
      }
    }
    child = ancestor;
    ancestor = ancestor.parent ?? null;
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
      if (hasDominatingLengthGuard(node, receiverArrayObject, indexedArrayObject)) return;

      context.report({
        node,
        message:
          "This is slow because .every() compares two arrays item by item, so check `a.length === b.length` first to bail out immediately when sizes differ",
      });
    },
  }),
});
