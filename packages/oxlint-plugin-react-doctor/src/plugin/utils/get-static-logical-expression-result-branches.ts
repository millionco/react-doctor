import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getFinalSequenceExpressionValue } from "./get-final-sequence-expression-value.js";
import { isNodeOfType } from "./is-node-of-type.js";

interface StaticExpressionResultBranch {
  readonly expression: EsTreeNode;
  readonly truthiness: "truthy" | "falsy" | "unknown";
  readonly nullishness: "nullish" | "non-nullish" | "unknown";
}

const deduplicateResultBranches = (
  branches: ReadonlyArray<StaticExpressionResultBranch>,
): ReadonlyArray<StaticExpressionResultBranch> => {
  const resultBranches: StaticExpressionResultBranch[] = [];
  const seenStatesByExpression = new Map<EsTreeNode, Set<string>>();
  for (const branch of branches) {
    const branchState = `${branch.truthiness}:${branch.nullishness}`;
    const seenStates = seenStatesByExpression.get(branch.expression);
    if (seenStates?.has(branchState)) continue;
    if (seenStates) {
      seenStates.add(branchState);
    } else {
      seenStatesByExpression.set(branch.expression, new Set([branchState]));
    }
    resultBranches.push(branch);
  }
  return resultBranches;
};

const getAtomicExpressionResultBranch = (expression: EsTreeNode): StaticExpressionResultBranch => {
  if (
    isNodeOfType(expression, "JSXElement") ||
    isNodeOfType(expression, "JSXFragment") ||
    isNodeOfType(expression, "ArrayExpression") ||
    isNodeOfType(expression, "ObjectExpression") ||
    isNodeOfType(expression, "ArrowFunctionExpression") ||
    isNodeOfType(expression, "FunctionExpression") ||
    isNodeOfType(expression, "ClassExpression") ||
    isNodeOfType(expression, "NewExpression")
  ) {
    return { expression, truthiness: "truthy", nullishness: "non-nullish" };
  }
  if (isNodeOfType(expression, "Literal")) {
    if (expression.value === null) {
      return { expression, truthiness: "falsy", nullishness: "nullish" };
    }
    return {
      expression,
      truthiness: expression.value ? "truthy" : "falsy",
      nullishness: "non-nullish",
    };
  }
  if (isNodeOfType(expression, "UnaryExpression") && expression.operator === "void") {
    return { expression, truthiness: "falsy", nullishness: "nullish" };
  }
  return { expression, truthiness: "unknown", nullishness: "unknown" };
};

const getStaticExpressionResultBranches = (
  expression: EsTreeNode,
): ReadonlyArray<StaticExpressionResultBranch> => {
  const finalExpression = getFinalSequenceExpressionValue(expression);
  if (isNodeOfType(finalExpression, "ConditionalExpression")) {
    return deduplicateResultBranches([
      ...getStaticExpressionResultBranches(finalExpression.consequent),
      ...getStaticExpressionResultBranches(finalExpression.alternate),
    ]);
  }
  if (!isNodeOfType(finalExpression, "LogicalExpression")) {
    return [getAtomicExpressionResultBranch(finalExpression)];
  }

  const leftBranches = getStaticExpressionResultBranches(finalExpression.left);
  const rightBranches = getStaticExpressionResultBranches(finalExpression.right);
  const resultBranches: StaticExpressionResultBranch[] = [];
  for (const leftBranch of leftBranches) {
    if (finalExpression.operator === "&&") {
      if (leftBranch.truthiness !== "truthy") {
        resultBranches.push(
          leftBranch.truthiness === "falsy" ? leftBranch : { ...leftBranch, truthiness: "falsy" },
        );
      }
      if (leftBranch.truthiness !== "falsy") resultBranches.push(...rightBranches);
      continue;
    }
    if (finalExpression.operator === "||") {
      if (leftBranch.truthiness !== "falsy") {
        resultBranches.push(
          leftBranch.truthiness === "truthy"
            ? leftBranch
            : { ...leftBranch, truthiness: "truthy", nullishness: "non-nullish" },
        );
      }
      if (leftBranch.truthiness !== "truthy") resultBranches.push(...rightBranches);
      continue;
    }
    if (leftBranch.nullishness !== "nullish") {
      resultBranches.push(
        leftBranch.nullishness === "non-nullish"
          ? leftBranch
          : { ...leftBranch, nullishness: "non-nullish" },
      );
    }
    if (leftBranch.nullishness !== "non-nullish") resultBranches.push(...rightBranches);
  }
  return deduplicateResultBranches(resultBranches);
};

export const getStaticLogicalExpressionResultBranches = (
  expression: EsTreeNodeOfType<"LogicalExpression">,
): ReadonlyArray<EsTreeNode> => {
  const resultExpressions: EsTreeNode[] = [];
  const seenExpressions = new Set<EsTreeNode>();
  for (const resultBranch of getStaticExpressionResultBranches(expression)) {
    if (seenExpressions.has(resultBranch.expression)) continue;
    seenExpressions.add(resultBranch.expression);
    resultExpressions.push(resultBranch.expression);
  }
  return resultExpressions;
};
