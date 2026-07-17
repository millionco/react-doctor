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
  readonly values: ReadonlyMap<number, PredicateValueConstraint>;
}

interface PredicateValueConstraint {
  readonly excludedValueKeys: ReadonlySet<string>;
  readonly requiredValueKey: string | null;
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

interface PredicateConstraint {
  readonly isEquality: boolean;
  readonly symbolId: number;
  readonly valueKey: string;
}

const literalValueKey = (expression: EsTreeNode): string | null => {
  const literal = stripParenExpression(expression);
  if (!isNodeOfType(literal, "Literal")) return null;
  if (
    typeof literal.value !== "boolean" &&
    typeof literal.value !== "number" &&
    typeof literal.value !== "string" &&
    literal.value !== null
  ) {
    return null;
  }
  return `${typeof literal.value}:${String(literal.value)}`;
};

const predicateConstraint = (
  expression: EsTreeNode,
  isTruthy: boolean,
  context: RuleContext,
): PredicateConstraint | null => {
  let current = stripParenExpression(expression);
  let expectedValue = isTruthy;
  while (isNodeOfType(current, "UnaryExpression") && current.operator === "!") {
    expectedValue = !expectedValue;
    current = stripParenExpression(current.argument);
  }
  let identifier: EsTreeNode | null = null;
  let valueKey = "boolean:true";
  let comparisonIsEquality = true;
  if (isNodeOfType(current, "Identifier")) {
    identifier = current;
  } else if (
    isNodeOfType(current, "BinaryExpression") &&
    ["===", "!==", "==", "!="].includes(current.operator)
  ) {
    const operands = [
      { identifier: current.left, literal: current.right },
      { identifier: current.right, literal: current.left },
    ];
    for (const operandsPair of operands) {
      const identifierExpression = stripParenExpression(operandsPair.identifier);
      const candidateValueKey = literalValueKey(operandsPair.literal);
      if (candidateValueKey !== null && isNodeOfType(identifierExpression, "Identifier")) {
        if (
          (current.operator === "==" || current.operator === "!=") &&
          !candidateValueKey.startsWith("boolean:")
        ) {
          continue;
        }
        identifier = identifierExpression;
        valueKey = candidateValueKey;
        comparisonIsEquality = current.operator === "===" || current.operator === "==";
        break;
      }
    }
  }
  if (!identifier) return null;
  const symbol = resolveConstIdentifierRootSymbol(identifier, context.scopes);
  return symbol
    ? {
        isEquality: comparisonIsEquality === expectedValue,
        symbolId: symbol.id,
        valueKey,
      }
    : null;
};

const addPredicateConstraint = (
  constraints: Map<number, PredicateValueConstraint>,
  expression: EsTreeNode,
  isTruthy: boolean,
  context: RuleContext,
): boolean => {
  const constraint = predicateConstraint(expression, isTruthy, context);
  if (!constraint) return false;
  const previousValue = constraints.get(constraint.symbolId) ?? {
    excludedValueKeys: new Set<string>(),
    requiredValueKey: null,
  };
  if (constraint.isEquality) {
    if (
      (previousValue.requiredValueKey !== null &&
        previousValue.requiredValueKey !== constraint.valueKey) ||
      previousValue.excludedValueKeys.has(constraint.valueKey)
    ) {
      return true;
    }
    constraints.set(constraint.symbolId, {
      excludedValueKeys: previousValue.excludedValueKeys,
      requiredValueKey: constraint.valueKey,
    });
    return false;
  }
  if (previousValue.requiredValueKey === constraint.valueKey) return true;
  constraints.set(constraint.symbolId, {
    excludedValueKeys: new Set([...previousValue.excludedValueKeys, constraint.valueKey]),
    requiredValueKey: previousValue.requiredValueKey,
  });
  return false;
};

const collectNodePredicateConstraints = (
  node: EsTreeNode,
  context: RuleContext,
): PredicateConstraints => {
  const cached = predicateConstraintsByNode.get(node);
  if (cached) return cached;
  const constraints = new Map<number, PredicateValueConstraint>();
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
    if (!rightValue) continue;
    if (
      (leftValue.requiredValueKey !== null &&
        rightValue.requiredValueKey !== null &&
        leftValue.requiredValueKey !== rightValue.requiredValueKey) ||
      (leftValue.requiredValueKey !== null &&
        rightValue.excludedValueKeys.has(leftValue.requiredValueKey)) ||
      (rightValue.requiredValueKey !== null &&
        leftValue.excludedValueKeys.has(rightValue.requiredValueKey))
    ) {
      return false;
    }
  }
  return true;
};
