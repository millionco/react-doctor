import type { EsTreeNode } from "./es-tree-node.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const isFunctionMetadataRead = (identifier: EsTreeNode): boolean => {
  const referenceRoot = findTransparentExpressionRoot(identifier);
  const parent = referenceRoot.parent;
  if (isNodeOfType(parent, "UnaryExpression") && parent.operator === "typeof") {
    return parent.argument === referenceRoot;
  }
  if (!isNodeOfType(parent, "MemberExpression") || parent.object !== referenceRoot) return false;
  const propertyName = getStaticPropertyKeyName(parent, { allowComputedString: true });
  if (propertyName !== "name" && propertyName !== "length") return false;
  const metadataRoot = findTransparentExpressionRoot(parent);
  const consumer = metadataRoot.parent;
  return !(
    (isNodeOfType(consumer, "AssignmentExpression") && consumer.left === metadataRoot) ||
    (isNodeOfType(consumer, "UpdateExpression") && consumer.argument === metadataRoot) ||
    (isNodeOfType(consumer, "UnaryExpression") &&
      consumer.operator === "delete" &&
      consumer.argument === metadataRoot) ||
    isNodeOfType(consumer, "ArrayPattern") ||
    (isNodeOfType(consumer, "Property") &&
      consumer.value === metadataRoot &&
      isNodeOfType(consumer.parent, "ObjectPattern")) ||
    (isNodeOfType(consumer, "RestElement") && consumer.argument === metadataRoot) ||
    (isNodeOfType(consumer, "AssignmentPattern") && consumer.left === metadataRoot) ||
    ((isNodeOfType(consumer, "ForInStatement") || isNodeOfType(consumer, "ForOfStatement")) &&
      consumer.left === metadataRoot) ||
    ((isNodeOfType(consumer, "CallExpression") || isNodeOfType(consumer, "NewExpression")) &&
      consumer.callee === metadataRoot) ||
    (isNodeOfType(consumer, "TaggedTemplateExpression") && consumer.tag === metadataRoot)
  );
};
