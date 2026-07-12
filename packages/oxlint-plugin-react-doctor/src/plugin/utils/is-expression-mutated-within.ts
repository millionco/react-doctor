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

const isExpressionOrMemberRoot = (candidate: EsTreeNode, expression: EsTreeNode): boolean => {
  let current = stripParenExpression(candidate);
  while (true) {
    if (areExpressionsStructurallyEqual(current, expression)) return true;
    if (!isNodeOfType(current, "MemberExpression")) return false;
    current = stripParenExpression(current.object);
  }
};

const resolvesToExpression = (
  candidate: EsTreeNode,
  expression: EsTreeNode,
  visitedBindings = new Set<EsTreeNode>(),
): boolean => {
  if (isExpressionOrMemberRoot(candidate, expression)) return true;
  if (!isNodeOfType(candidate, "Identifier")) return false;
  const binding = findVariableInitializer(candidate, candidate.name);
  if (!binding?.initializer || visitedBindings.has(binding.bindingIdentifier)) return false;
  visitedBindings.add(binding.bindingIdentifier);
  return resolvesToExpression(binding.initializer, expression, visitedBindings);
};

export const isExpressionMutatedWithin = (expression: EsTreeNode, root: EsTreeNode): boolean => {
  let didFindMutation = false;
  walkAst(root, (node) => {
    if (didFindMutation) return false;
    const writeTarget = isNodeOfType(node, "AssignmentExpression")
      ? node.left
      : isNodeOfType(node, "UpdateExpression")
        ? node.argument
        : null;
    if (writeTarget && isExpressionOrMemberRoot(writeTarget, expression)) {
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
      resolvesToExpression(node.callee.object, expression)
    ) {
      didFindMutation = true;
      return false;
    }
  });
  return didFindMutation;
};
