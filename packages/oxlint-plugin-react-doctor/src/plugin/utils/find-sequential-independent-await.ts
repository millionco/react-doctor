import { collectPatternNames } from "./collect-pattern-names.js";
import { collectReferenceIdentifierNames } from "./collect-reference-identifier-names.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { isNodeOfType } from "./is-node-of-type.js";

interface AwaitedStatementInfo {
  awaitedExpressions: EsTreeNode[];
  boundNames: string[];
}

const getAwaitedStatementInfo = (statement: EsTreeNode): AwaitedStatementInfo | null => {
  const awaitedExpressions: EsTreeNode[] = [];
  const boundNames = new Set<string>();

  if (isNodeOfType(statement, "VariableDeclaration")) {
    for (const declarator of statement.declarations ?? []) {
      if (!isNodeOfType(declarator.init, "AwaitExpression")) continue;
      if (declarator.init.argument) awaitedExpressions.push(declarator.init.argument);
      collectPatternNames(declarator.id, boundNames);
    }
  } else if (isNodeOfType(statement, "ExpressionStatement")) {
    const expression = statement.expression;
    if (isNodeOfType(expression, "AwaitExpression")) {
      if (expression.argument) awaitedExpressions.push(expression.argument);
    } else if (
      isNodeOfType(expression, "AssignmentExpression") &&
      isNodeOfType(expression.right, "AwaitExpression")
    ) {
      if (expression.right.argument) awaitedExpressions.push(expression.right.argument);
      if (isNodeOfType(expression.left, "Identifier")) boundNames.add(expression.left.name);
    }
  } else if (
    isNodeOfType(statement, "ReturnStatement") &&
    isNodeOfType(statement.argument, "AwaitExpression")
  ) {
    if (statement.argument.argument) awaitedExpressions.push(statement.argument.argument);
  } else if (isNodeOfType(statement, "ForOfStatement") && statement.await) {
    if (statement.right) awaitedExpressions.push(statement.right);
    const loopBinding = isNodeOfType(statement.left, "VariableDeclaration")
      ? (statement.left.declarations?.[0]?.id ?? null)
      : statement.left;
    collectPatternNames(loopBinding, boundNames);
  }

  return awaitedExpressions.length === 0
    ? null
    : { awaitedExpressions, boundNames: [...boundNames] };
};

const collectStatementBoundNames = (statement: EsTreeNode, into: Set<string>): void => {
  if (!isNodeOfType(statement, "VariableDeclaration")) return;
  for (const declarator of statement.declarations ?? []) {
    collectPatternNames(declarator.id, into);
  }
};

export const findSequentialIndependentAwait = (
  blockStatement: EsTreeNodeOfType<"BlockStatement">,
  threshold: number,
  isCandidate?: (expression: EsTreeNode) => boolean,
): EsTreeNode | null => {
  const taintingAwaitIndicesByName = new Map<string, ReadonlySet<number>>();
  const seenAwaitDependencySets: ReadonlySet<number>[] = [];

  for (const statement of blockStatement.body ?? []) {
    const awaitedInfo = getAwaitedStatementInfo(statement);
    if (!awaitedInfo) {
      const boundNames = new Set<string>();
      collectStatementBoundNames(statement, boundNames);
      if (boundNames.size === 0) continue;
      const referencedNames = new Set<string>();
      collectReferenceIdentifierNames(statement, referencedNames);
      const inheritedTaint = new Set<number>();
      for (const name of referencedNames) {
        for (const awaitIndex of taintingAwaitIndicesByName.get(name) ?? []) {
          inheritedTaint.add(awaitIndex);
        }
      }
      if (inheritedTaint.size === 0) continue;
      for (const name of boundNames) taintingAwaitIndicesByName.set(name, inheritedTaint);
      continue;
    }
    if (
      isCandidate &&
      !awaitedInfo.awaitedExpressions.every((awaitedExpression) => isCandidate(awaitedExpression))
    ) {
      taintingAwaitIndicesByName.clear();
      seenAwaitDependencySets.length = 0;
      continue;
    }

    const referencedNames = new Set<string>();
    for (const awaitedExpression of awaitedInfo.awaitedExpressions) {
      collectReferenceIdentifierNames(awaitedExpression, referencedNames);
    }
    const dependsOnAwaitIndices = new Set<number>();
    for (const name of referencedNames) {
      for (const awaitIndex of taintingAwaitIndicesByName.get(name) ?? []) {
        dependsOnAwaitIndices.add(awaitIndex);
      }
    }

    const independentEarlierAwaitCount = seenAwaitDependencySets.filter(
      (_, earlierAwaitIndex) => !dependsOnAwaitIndices.has(earlierAwaitIndex),
    ).length;
    if (independentEarlierAwaitCount + 1 >= threshold) return statement;

    const currentAwaitIndex = seenAwaitDependencySets.length;
    seenAwaitDependencySets.push(dependsOnAwaitIndices);
    const boundTaint = new Set(dependsOnAwaitIndices);
    boundTaint.add(currentAwaitIndex);
    for (const name of awaitedInfo.boundNames) {
      taintingAwaitIndicesByName.set(name, boundTaint);
    }
  }

  return null;
};
