import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticTemplateLiteralValue } from "../../utils/get-static-template-literal-value.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";

const TRANSPARENT_WRAPPER_TYPES: ReadonlySet<string> = new Set([
  "TSAsExpression",
  "TSSatisfiesExpression",
  "TSNonNullExpression",
  "TSTypeAssertion",
  "ParenthesizedExpression",
  "ChainExpression",
]);

export const isTransparentWrapperType = (nodeType: string): boolean =>
  TRANSPARENT_WRAPPER_TYPES.has(nodeType);

export const unwrapExpression = (node: EsTreeNode): EsTreeNode => {
  let current = node;
  while (TRANSPARENT_WRAPPER_TYPES.has(current.type)) {
    const inner = (current as { expression?: EsTreeNode | null }).expression;
    if (!inner) return current;
    current = inner;
  }
  return current;
};

export const stringifyMemberChain = (node: EsTreeNode): string | null => {
  const stripped = unwrapExpression(node);
  if (isNodeOfType(stripped, "Identifier")) return stripped.name;
  if (isNodeOfType(stripped, "ThisExpression")) return "this";
  if (isNodeOfType(stripped, "MemberExpression")) {
    const objectName = stringifyMemberChain(stripped.object);
    if (objectName && stripped.computed) return objectName;
    if (objectName && !stripped.computed && isNodeOfType(stripped.property, "Identifier")) {
      return `${objectName}.${stripped.property.name}`;
    }
  }
  return null;
};

export const getMemberRootIdentifier = (
  node: EsTreeNode,
): EsTreeNodeOfType<"Identifier"> | null => {
  const stripped = unwrapExpression(node);
  if (isNodeOfType(stripped, "Identifier")) return stripped;
  if (isNodeOfType(stripped, "MemberExpression")) return getMemberRootIdentifier(stripped.object);
  return null;
};

export const hasComputedMemberExpression = (node: EsTreeNode): boolean => {
  const stripped = unwrapExpression(node);
  if (!isNodeOfType(stripped, "MemberExpression")) return false;
  if (stripped.computed) return true;
  return hasComputedMemberExpression(stripped.object);
};

export const isLiteralOrEmptyTemplate = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "Literal") ||
  (isNodeOfType(node, "TemplateLiteral") && getStaticTemplateLiteralValue(node) !== null);

export const isNonStringLiteral = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "Literal") && typeof node.value !== "string";

export const isMatchingDepOrPrefix = (declaredKey: string, captureKey: string): boolean =>
  captureKey === declaredKey || captureKey.startsWith(`${declaredKey}.`);

export const hasBroaderDeclaredDependency = (
  declaredKey: string,
  declaredKeys: ReadonlySet<string>,
): boolean => {
  for (const otherDeclaredKey of declaredKeys) {
    if (otherDeclaredKey !== declaredKey && declaredKey.startsWith(`${otherDeclaredKey}.`)) {
      return true;
    }
  }
  return false;
};
