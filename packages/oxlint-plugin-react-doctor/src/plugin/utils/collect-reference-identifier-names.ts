import { collectPatternNames } from "./collect-pattern-names.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isAstNode } from "./is-ast-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

const TYPE_POSITION_KEYS = new Set([
  "typeAnnotation",
  "typeParameters",
  "typeArguments",
  "returnType",
  "superTypeArguments",
  "superTypeParameters",
]);

const collectScopedReferencesInPattern = (
  pattern: EsTreeNode | null | undefined,
  into: Set<string>,
  shadowed: ReadonlySet<string>,
): void => {
  if (!pattern) return;
  if (isNodeOfType(pattern, "Identifier")) return;
  if (isNodeOfType(pattern, "AssignmentPattern")) {
    collectScopedReferenceIdentifierNames(pattern.right, into, shadowed);
    collectScopedReferencesInPattern(pattern.left, into, shadowed);
    return;
  }
  if (isNodeOfType(pattern, "RestElement")) {
    collectScopedReferencesInPattern(pattern.argument, into, shadowed);
    return;
  }
  if (isNodeOfType(pattern, "ArrayPattern")) {
    for (const element of pattern.elements ?? []) {
      collectScopedReferencesInPattern(element, into, shadowed);
    }
    return;
  }
  if (isNodeOfType(pattern, "ObjectPattern")) {
    for (const property of pattern.properties ?? []) {
      if (isNodeOfType(property, "RestElement")) {
        collectScopedReferencesInPattern(property.argument, into, shadowed);
        continue;
      }
      if (!isNodeOfType(property, "Property")) continue;
      if (property.computed) collectScopedReferenceIdentifierNames(property.key, into, shadowed);
      collectScopedReferencesInPattern(property.value, into, shadowed);
    }
  }
};

const collectFromFunction = (
  functionNode: EsTreeNode,
  into: Set<string>,
  shadowed: ReadonlySet<string>,
): void => {
  if (
    !isNodeOfType(functionNode, "FunctionDeclaration") &&
    !isNodeOfType(functionNode, "FunctionExpression") &&
    !isNodeOfType(functionNode, "ArrowFunctionExpression")
  ) {
    return;
  }
  const innerShadowed = new Set(shadowed);
  for (const param of functionNode.params ?? []) {
    collectPatternNames(param, innerShadowed);
  }
  for (const param of functionNode.params ?? []) {
    collectScopedReferencesInPattern(param, into, innerShadowed);
  }
  collectScopedReferenceIdentifierNames(functionNode.body, into, innerShadowed);
};

const collectScopedReferenceIdentifierNames = (
  node: EsTreeNode | null | undefined,
  into: Set<string>,
  shadowed: ReadonlySet<string>,
): void => {
  if (!node) return;
  if (isNodeOfType(node, "Identifier")) {
    if (!shadowed.has(node.name)) into.add(node.name);
    return;
  }
  if (isNodeOfType(node, "MemberExpression")) {
    collectScopedReferenceIdentifierNames(node.object, into, shadowed);
    if (node.computed) collectScopedReferenceIdentifierNames(node.property, into, shadowed);
    return;
  }
  if (isNodeOfType(node, "Property")) {
    if (node.computed) collectScopedReferenceIdentifierNames(node.key, into, shadowed);
    collectScopedReferenceIdentifierNames(node.value, into, shadowed);
    return;
  }
  if (
    isNodeOfType(node, "FunctionDeclaration") ||
    isNodeOfType(node, "FunctionExpression") ||
    isNodeOfType(node, "ArrowFunctionExpression")
  ) {
    collectFromFunction(node, into, shadowed);
    return;
  }
  if (
    isNodeOfType(node, "TSAsExpression") ||
    isNodeOfType(node, "TSSatisfiesExpression") ||
    isNodeOfType(node, "TSTypeAssertion") ||
    isNodeOfType(node, "TSNonNullExpression") ||
    isNodeOfType(node, "TSInstantiationExpression")
  ) {
    collectScopedReferenceIdentifierNames(node.expression, into, shadowed);
    return;
  }
  if (typeof node.type === "string" && node.type.startsWith("TS")) return;
  for (const [key, child] of Object.entries(node)) {
    if (key === "parent") continue;
    if (TYPE_POSITION_KEYS.has(key)) continue;
    if (Array.isArray(child)) {
      for (const item of child) {
        if (isAstNode(item)) collectScopedReferenceIdentifierNames(item, into, shadowed);
      }
    } else if (isAstNode(child)) {
      collectScopedReferenceIdentifierNames(child, into, shadowed);
    }
  }
};

export const collectReferenceIdentifierNames = (
  node: EsTreeNode | null | undefined,
  into: Set<string>,
): void => collectScopedReferenceIdentifierNames(node, into, new Set());
