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

interface PredicateConstraints {
  readonly isImpossible: boolean;
  readonly values: ReadonlyMap<number, boolean>;
}

const exitingPredicatesByBlock = new WeakMap<EsTreeNode, ExitingPredicate[]>();
const predicateConstraintsByNode = new WeakMap<EsTreeNode, PredicateConstraints>();
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
  let identifier: EsTreeNode | null = null;
  if (isNodeOfType(current, "Identifier")) {
    identifier = current;
  } else if (
    isNodeOfType(current, "BinaryExpression") &&
    ["===", "!==", "==", "!="].includes(current.operator)
  ) {
    const operands = [
      { boolean: current.right, identifier: current.left },
      { boolean: current.left, identifier: current.right },
    ];
    for (const operandsPair of operands) {
      const booleanExpression = stripParenExpression(operandsPair.boolean);
      const identifierExpression = stripParenExpression(operandsPair.identifier);
      if (
        isNodeOfType(booleanExpression, "Literal") &&
        typeof booleanExpression.value === "boolean" &&
        isNodeOfType(identifierExpression, "Identifier")
      ) {
        identifier = identifierExpression;
        const comparisonIsEquality = current.operator === "===" || current.operator === "==";
        expectedValue =
          booleanExpression.value === comparisonIsEquality ? expectedValue : !expectedValue;
        break;
      }
    }
  }
  if (!identifier) return null;
  const symbol = resolveConstIdentifierRootSymbol(identifier, context.scopes);
  return symbol ? [symbol.id, expectedValue] : null;
};

const addPredicateConstraint = (
  constraints: Map<number, boolean>,
  expression: EsTreeNode,
  isTruthy: boolean,
  context: RuleContext,
): boolean => {
  const constraint = predicateConstraint(expression, isTruthy, context);
  if (!constraint) return false;
  const previousValue = constraints.get(constraint[0]);
  if (previousValue !== undefined && previousValue !== constraint[1]) return true;
  constraints.set(constraint[0], constraint[1]);
  return false;
};

const collectNodePredicateConstraints = (
  node: EsTreeNode,
  context: RuleContext,
): PredicateConstraints => {
  const cached = predicateConstraintsByNode.get(node);
  if (cached) return cached;
  const constraints = new Map<number, boolean>();
  let isImpossible = false;
  let child: EsTreeNode = node;
  let parent = node.parent;
  while (parent) {
    if (isNodeOfType(parent, "IfStatement")) {
      if (parent.consequent === child) {
        isImpossible ||= addPredicateConstraint(constraints, parent.test, true, context);
      } else if (parent.alternate === child) {
        isImpossible ||= addPredicateConstraint(constraints, parent.test, false, context);
      }
    } else if (isNodeOfType(parent, "ConditionalExpression")) {
      if (parent.consequent === child) {
        isImpossible ||= addPredicateConstraint(constraints, parent.test, true, context);
      } else if (parent.alternate === child) {
        isImpossible ||= addPredicateConstraint(constraints, parent.test, false, context);
      }
    } else if (isNodeOfType(parent, "LogicalExpression") && parent.right === child) {
      if (parent.operator === "&&") {
        isImpossible ||= addPredicateConstraint(constraints, parent.left, true, context);
      } else if (parent.operator === "||") {
        isImpossible ||= addPredicateConstraint(constraints, parent.left, false, context);
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
        isImpossible ||= addPredicateConstraint(
          constraints,
          predicate.test,
          predicate.isTruthy,
          context,
        );
      }
    }
    child = parent;
    parent = parent.parent;
  }
  const result = { isImpossible, values: constraints };
  predicateConstraintsByNode.set(node, result);
  return result;
};

export const nodesCanCoExecute = (
  left: EsTreeNode,
  right: EsTreeNode,
  context: RuleContext,
): boolean => {
  const leftConstraints = collectNodePredicateConstraints(left, context);
  const rightConstraints = collectNodePredicateConstraints(right, context);
  if (leftConstraints.isImpossible || rightConstraints.isImpossible) return false;
  for (const [symbolId, leftValue] of leftConstraints.values) {
    const rightValue = rightConstraints.values.get(symbolId);
    if (rightValue !== undefined && rightValue !== leftValue) return false;
  }
  return true;
};
