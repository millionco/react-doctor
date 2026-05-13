import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

// HACK: structural equality for "value-shaped" expressions used by
// detectors that need to assert two reads of the same external value
// (e.g. `prefer-use-sync-external-store` checks that the
// `useState(getSnapshot())` initializer matches the
// `setSnapshot(getSnapshot())` inside the subscribe handler).
// Deliberately conservative - we only model Identifier / Literal /
// MemberExpression / CallExpression because any other shape
// (assignments, ternaries, template strings) shouldn't be relied on
// for a "same external store read" claim.
export const areExpressionsStructurallyEqual = (
  a: EsTreeNode | null | undefined,
  b: EsTreeNode | null | undefined,
): boolean => {
  if (!a || !b) return a === b;
  if (a.type !== b.type) return false;
  if (isNodeOfType(a, "Identifier")) return a.name === b.name;
  if (isNodeOfType(a, "Literal")) return a.value === b.value;
  if (isNodeOfType(a, "MemberExpression")) {
    if (a.computed !== b.computed) return false;
    return (
      areExpressionsStructurallyEqual(a.object, b.object) &&
      areExpressionsStructurallyEqual(a.property, b.property)
    );
  }
  if (isNodeOfType(a, "CallExpression")) {
    if (!areExpressionsStructurallyEqual(a.callee, b.callee)) return false;
    const argumentsA = a.arguments ?? [];
    const argumentsB = b.arguments ?? [];
    if (argumentsA.length !== argumentsB.length) return false;
    return argumentsA.every((argument: EsTreeNode, index: number) =>
      areExpressionsStructurallyEqual(argument, argumentsB[index]),
    );
  }
  return false;
};
