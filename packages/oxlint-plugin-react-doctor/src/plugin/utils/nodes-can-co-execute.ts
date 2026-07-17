import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { resolveConstIdentifierRootSymbol } from "./resolve-const-identifier-root-symbol.js";
import type { RuleContext } from "./rule-context.js";
import { statementAlwaysExits } from "./statement-always-exits.js";
import { stripParenExpression } from "./strip-paren-expression.js";

interface ExitingPredicate {
  readonly isTruthy: boolean;
  readonly statementIndex: number;
  readonly test: EsTreeNode;
}

const exitingPredicatesByBlock = new WeakMap<EsTreeNode, ExitingPredicate[]>();
const predicateConstraintsByNode = new WeakMap<EsTreeNode, ReadonlyMap<number, boolean>>();
const statementIndexesByBlock = new WeakMap<EsTreeNode, ReadonlyMap<EsTreeNode, number>>();

const getExitingPredicates = (block: EsTreeNode): ExitingPredicate[] => {
  const cached = exitingPredicatesByBlock.get(block);
  if (cached) return cached;
  const predicates: ExitingPredicate[] = [];
  if (isNodeOfType(block, "BlockStatement")) {
    for (const [statementIndex, statement] of block.body.entries()) {
      if (!isNodeOfType(statement, "IfStatement")) continue;
      if (statementAlwaysExits(statement.consequent)) {
        predicates.push({ isTruthy: false, statementIndex, test: statement.test });
      }
      if (statement.alternate && statementAlwaysExits(statement.alternate)) {
        predicates.push({ isTruthy: true, statementIndex, test: statement.test });
      }
    }
  }
  exitingPredicatesByBlock.set(block, predicates);
  return predicates;
};

const predicateConstraint = (
  expression: EsTreeNode,
  isTruthy: boolean,
  context: RuleContext,
): readonly [number, boolean] | null => {
  let current = stripParenExpression(expression);
  let expectedValue = isTruthy;
  while (isNodeOfType(current, "UnaryExpression") && current.operator === "!") {
    expectedValue = !expectedValue;
    current = stripParenExpression(current.argument);
  }
  if (!isNodeOfType(current, "Identifier")) return null;
  const symbol = resolveConstIdentifierRootSymbol(current, context.scopes);
  return symbol ? [symbol.id, expectedValue] : null;
};

const addPredicateConstraint = (
  constraints: Map<number, boolean>,
  expression: EsTreeNode,
  isTruthy: boolean,
  context: RuleContext,
): void => {
  const constraint = predicateConstraint(expression, isTruthy, context);
  if (constraint) constraints.set(constraint[0], constraint[1]);
};

const collectNodePredicateConstraints = (
  node: EsTreeNode,
  context: RuleContext,
): ReadonlyMap<number, boolean> => {
  const cached = predicateConstraintsByNode.get(node);
  if (cached) return cached;
  const constraints = new Map<number, boolean>();
  let child: EsTreeNode = node;
  let parent = node.parent;
  while (parent) {
    if (isNodeOfType(parent, "IfStatement")) {
      if (parent.consequent === child) {
        addPredicateConstraint(constraints, parent.test, true, context);
      } else if (parent.alternate === child) {
        addPredicateConstraint(constraints, parent.test, false, context);
      }
    } else if (isNodeOfType(parent, "ConditionalExpression")) {
      if (parent.consequent === child) {
        addPredicateConstraint(constraints, parent.test, true, context);
      } else if (parent.alternate === child) {
        addPredicateConstraint(constraints, parent.test, false, context);
      }
    } else if (isNodeOfType(parent, "LogicalExpression") && parent.right === child) {
      if (parent.operator === "&&") {
        addPredicateConstraint(constraints, parent.left, true, context);
      } else if (parent.operator === "||") {
        addPredicateConstraint(constraints, parent.left, false, context);
      }
    } else if (isNodeOfType(parent, "BlockStatement")) {
      let containingStatement = child;
      while (containingStatement.parent && containingStatement.parent !== parent) {
        containingStatement = containingStatement.parent;
      }
      let statementIndexes = statementIndexesByBlock.get(parent);
      if (!statementIndexes) {
        statementIndexes = new Map(
          parent.body.map((statement, statementIndex) => [statement, statementIndex]),
        );
        statementIndexesByBlock.set(parent, statementIndexes);
      }
      const statementIndex = statementIndexes.get(containingStatement) ?? -1;
      for (const predicate of getExitingPredicates(parent)) {
        if (predicate.statementIndex >= statementIndex) break;
        addPredicateConstraint(constraints, predicate.test, predicate.isTruthy, context);
      }
    }
    child = parent;
    parent = parent.parent;
  }
  predicateConstraintsByNode.set(node, constraints);
  return constraints;
};

export const nodesCanCoExecute = (
  left: EsTreeNode,
  right: EsTreeNode,
  context: RuleContext,
): boolean => {
  const leftConstraints = collectNodePredicateConstraints(left, context);
  const rightConstraints = collectNodePredicateConstraints(right, context);
  for (const [symbolId, leftValue] of leftConstraints) {
    const rightValue = rightConstraints.get(symbolId);
    if (rightValue !== undefined && rightValue !== leftValue) return false;
  }
  return true;
};
