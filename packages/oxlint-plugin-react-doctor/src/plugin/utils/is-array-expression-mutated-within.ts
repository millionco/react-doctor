import { areExpressionsStructurallyEqual } from "./are-expressions-structurally-equal.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findVariableInitializer } from "./find-variable-initializer.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

const MUTATING_ARRAY_METHOD_NAMES: ReadonlySet<string> = new Set([
  "copyWithin",
  "fill",
  "pop",
  "push",
  "reverse",
  "shift",
  "sort",
  "splice",
  "unshift",
]);

const OBJECT_MUTATION_METHOD_NAMES: ReadonlySet<string> = new Set([
  "assign",
  "defineProperties",
  "defineProperty",
  "setPrototypeOf",
]);

const REFLECT_MUTATION_METHOD_NAMES: ReadonlySet<string> = new Set([
  "defineProperty",
  "deleteProperty",
  "set",
  "setPrototypeOf",
]);

const collectAliasSources = (
  expression: EsTreeNode,
  sources: EsTreeNode[],
  visitedBindings: Set<EsTreeNode>,
): void => {
  const strippedExpression = stripParenExpression(expression);
  sources.push(strippedExpression);
  if (!isNodeOfType(strippedExpression, "Identifier")) return;
  const binding = findVariableInitializer(strippedExpression, strippedExpression.name);
  if (!binding?.initializer || visitedBindings.has(binding.bindingIdentifier)) return;
  visitedBindings.add(binding.bindingIdentifier);
  collectAliasSources(binding.initializer, sources, visitedBindings);
};

const areAliasEquivalent = (left: EsTreeNode, right: EsTreeNode): boolean => {
  const strippedLeft = stripParenExpression(left);
  const strippedRight = stripParenExpression(right);
  if (
    isNodeOfType(strippedLeft, "MemberExpression") &&
    isNodeOfType(strippedRight, "MemberExpression")
  ) {
    const leftPropertyName = getStaticPropertyName(strippedLeft);
    const rightPropertyName = getStaticPropertyName(strippedRight);
    const doPropertiesMatch =
      leftPropertyName !== null && rightPropertyName !== null
        ? leftPropertyName === rightPropertyName
        : strippedLeft.computed === strippedRight.computed &&
          areExpressionsStructurallyEqual(strippedLeft.property, strippedRight.property);
    if (doPropertiesMatch && areAliasEquivalent(strippedLeft.object, strippedRight.object)) {
      return true;
    }
  }
  const leftSources: EsTreeNode[] = [];
  const rightSources: EsTreeNode[] = [];
  collectAliasSources(left, leftSources, new Set());
  collectAliasSources(right, rightSources, new Set());
  for (const leftSource of leftSources) {
    for (const rightSource of rightSources) {
      if (areExpressionsStructurallyEqual(leftSource, rightSource)) return true;
    }
  }
  return false;
};

const isExpressionOrAliasedMemberRoot = (
  candidate: EsTreeNode,
  expression: EsTreeNode,
): boolean => {
  let current = stripParenExpression(candidate);
  while (true) {
    if (areAliasEquivalent(current, expression)) return true;
    if (!isNodeOfType(current, "MemberExpression")) return false;
    current = stripParenExpression(current.object);
  }
};

const getCanonicalExpressionMutationKey = (
  expression: EsTreeNode,
  visitedBindings: Set<EsTreeNode>,
): string | null => {
  const strippedExpression = stripParenExpression(expression);
  if (isNodeOfType(strippedExpression, "ThisExpression")) return "this";
  if (isNodeOfType(strippedExpression, "Identifier")) {
    const binding = findVariableInitializer(strippedExpression, strippedExpression.name);
    if (binding && !visitedBindings.has(binding.bindingIdentifier)) {
      visitedBindings.add(binding.bindingIdentifier);
      if (
        binding.initializer &&
        (isNodeOfType(binding.initializer, "Identifier") ||
          isNodeOfType(binding.initializer, "MemberExpression"))
      ) {
        const initializerKey = getCanonicalExpressionMutationKey(
          binding.initializer,
          visitedBindings,
        );
        if (initializerKey) return initializerKey;
      }
      return `binding:${binding.bindingIdentifier.range[0]}:${binding.bindingIdentifier.range[1]}`;
    }
    return `identifier:${strippedExpression.name}`;
  }
  if (!isNodeOfType(strippedExpression, "MemberExpression")) return null;
  const objectKey = getCanonicalExpressionMutationKey(strippedExpression.object, visitedBindings);
  const propertyName = getStaticPropertyName(strippedExpression);
  if (!objectKey || propertyName === null) return null;
  return `${objectKey}.${propertyName}`;
};

export const getArrayExpressionMutationKey = (expression: EsTreeNode): string | null =>
  getCanonicalExpressionMutationKey(expression, new Set());

export const isArrayExpressionMutatedWithin = (
  expression: EsTreeNode,
  root: EsTreeNode,
): boolean => {
  let didFindMutation = false;
  walkAst(root, (node) => {
    if (didFindMutation) return false;
    const writeTarget = isNodeOfType(node, "AssignmentExpression")
      ? node.left
      : isNodeOfType(node, "UpdateExpression")
        ? node.argument
        : isNodeOfType(node, "UnaryExpression") && node.operator === "delete"
          ? node.argument
          : null;
    if (writeTarget && isExpressionOrAliasedMemberRoot(writeTarget, expression)) {
      didFindMutation = true;
      return false;
    }
    if (!isNodeOfType(node, "CallExpression") || !isNodeOfType(node.callee, "MemberExpression")) {
      return;
    }
    const methodName = getStaticPropertyName(node.callee);
    if (
      methodName &&
      MUTATING_ARRAY_METHOD_NAMES.has(methodName) &&
      isExpressionOrAliasedMemberRoot(node.callee.object, expression)
    ) {
      didFindMutation = true;
      return false;
    }
    if (!methodName || !isNodeOfType(node.callee.object, "Identifier")) return;
    const isObjectMutation =
      node.callee.object.name === "Object" && OBJECT_MUTATION_METHOD_NAMES.has(methodName);
    const isReflectMutation =
      node.callee.object.name === "Reflect" && REFLECT_MUTATION_METHOD_NAMES.has(methodName);
    const mutationTarget = node.arguments[0];
    if (
      (isObjectMutation || isReflectMutation) &&
      mutationTarget &&
      !isNodeOfType(mutationTarget, "SpreadElement") &&
      isExpressionOrAliasedMemberRoot(mutationTarget, expression)
    ) {
      didFindMutation = true;
      return false;
    }
  });
  return didFindMutation;
};
