import type { EsTreeNode } from "./es-tree-node.js";
import { getDirectConstInitializer } from "./get-direct-const-initializer.js";
import { isFiniteEffectCallbackBooleanInput } from "./is-finite-effect-callback-boolean-input.js";
import { isBindingAssignmentTarget } from "./is-binding-assignment-target.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { readInitialStateBoolean } from "./read-initial-state-boolean.js";
import type { RuleContext } from "./rule-context.js";
import { stripParenExpression } from "./strip-paren-expression.js";

interface CallbackPredicateClassification {
  readonly isStaticPrimitive: boolean;
  readonly isUnsupported: boolean;
}

interface UseCallbackExecutionPathOptions {
  readonly allowTruthyRegexGuard?: boolean;
}

const UNSUPPORTED_EXECUTION_ANCESTOR_TYPES: ReadonlySet<string> = new Set([
  "DoWhileStatement",
  "ForInStatement",
  "ForOfStatement",
  "ForStatement",
  "SwitchCase",
  "SwitchStatement",
  "WhileStatement",
]);

const classifyCallbackPredicate = (
  expression: EsTreeNode,
  context: RuleContext,
  visitedSymbolIds = new Set<number>(),
): CallbackPredicateClassification => {
  const predicate = stripParenExpression(expression);
  if (isNodeOfType(predicate, "Literal")) {
    const isNativePrimitive =
      !("regex" in predicate) &&
      (!("bigint" in predicate) || typeof predicate.value === "bigint") &&
      (predicate.value === null ||
        ["boolean", "number", "string", "bigint"].includes(typeof predicate.value));
    return { isStaticPrimitive: isNativePrimitive, isUnsupported: !isNativePrimitive };
  }
  if (isNodeOfType(predicate, "Identifier")) {
    if (predicate.name === "undefined" && context.scopes.isGlobalReference(predicate)) {
      return { isStaticPrimitive: true, isUnsupported: false };
    }
    const symbol = context.scopes.symbolFor(predicate);
    if (!symbol) return { isStaticPrimitive: false, isUnsupported: true };
    const initializer = getDirectConstInitializer(symbol);
    if (!initializer) return { isStaticPrimitive: false, isUnsupported: false };
    if (
      visitedSymbolIds.has(symbol.id) ||
      symbol.declarationNode.range[1] > predicate.range[0] ||
      symbol.references.some(
        (reference) => reference.flag !== "read" || isBindingAssignmentTarget(reference.identifier),
      )
    ) {
      return { isStaticPrimitive: false, isUnsupported: true };
    }
    return classifyCallbackPredicate(
      initializer,
      context,
      new Set(visitedSymbolIds).add(symbol.id),
    );
  }
  if (isNodeOfType(predicate, "UnaryExpression")) {
    return classifyCallbackPredicate(predicate.argument, context, visitedSymbolIds);
  }
  if (isNodeOfType(predicate, "BinaryExpression") || isNodeOfType(predicate, "LogicalExpression")) {
    const left = classifyCallbackPredicate(predicate.left, context, visitedSymbolIds);
    const right = classifyCallbackPredicate(predicate.right, context, visitedSymbolIds);
    return {
      isStaticPrimitive: left.isStaticPrimitive && right.isStaticPrimitive,
      isUnsupported:
        left.isUnsupported ||
        right.isUnsupported ||
        (isNodeOfType(predicate, "LogicalExpression") &&
          (!left.isStaticPrimitive || !right.isStaticPrimitive)),
    };
  }
  return {
    isStaticPrimitive: false,
    isUnsupported: !isNodeOfType(predicate, "MemberExpression"),
  };
};

export const isSupportedUseCallbackExecutionPath = (
  node: EsTreeNode,
  callback: EsTreeNode,
  context: RuleContext,
  options: UseCallbackExecutionPathOptions = {},
): boolean => {
  let child = node;
  let parent = child.parent;
  while (parent && parent !== callback) {
    if (UNSUPPORTED_EXECUTION_ANCESTOR_TYPES.has(parent.type)) return false;
    let predicate: EsTreeNode | null = null;
    let requiredTruthiness: boolean | null = null;
    if (
      (isNodeOfType(parent, "IfStatement") || isNodeOfType(parent, "ConditionalExpression")) &&
      (parent.consequent === child || parent.alternate === child)
    ) {
      predicate = parent.test;
      requiredTruthiness = parent.consequent === child;
    } else if (isNodeOfType(parent, "LogicalExpression") && parent.right === child) {
      predicate = parent.left;
      if (parent.operator === "&&") requiredTruthiness = true;
      if (parent.operator === "||") requiredTruthiness = false;
      if (requiredTruthiness === null) return false;
    }
    if (predicate && requiredTruthiness !== null) {
      const predicateRoot = stripParenExpression(predicate);
      if (isNodeOfType(predicateRoot, "Literal") && "regex" in predicateRoot) {
        if (!options.allowTruthyRegexGuard || !requiredTruthiness) return false;
      } else {
        if (isFiniteEffectCallbackBooleanInput(predicate, context)) {
          child = parent;
          parent = child.parent;
          continue;
        }
        const classification = classifyCallbackPredicate(predicate, context);
        if (classification.isUnsupported) return false;
        if (classification.isStaticPrimitive) {
          const truthiness = readInitialStateBoolean(predicate, context.scopes);
          if (truthiness === null || truthiness !== requiredTruthiness) return false;
        }
      }
    }
    child = parent;
    parent = child.parent;
  }
  return parent === callback;
};
