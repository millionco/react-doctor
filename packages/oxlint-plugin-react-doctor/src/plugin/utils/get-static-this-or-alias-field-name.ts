import type { EsTreeNode } from "./es-tree-node.js";
import { findEnclosingClass } from "./find-enclosing-class.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export const getStaticThisOrAliasFieldName = (
  node: EsTreeNode,
  thisAliasNames: ReadonlySet<string>,
  classNode?: EsTreeNode,
): string | null => {
  const candidate = stripParenExpression(node);
  if (!isNodeOfType(candidate, "MemberExpression")) return null;
  const receiver = stripParenExpression(candidate.object as EsTreeNode);
  const isClassThis =
    isNodeOfType(receiver, "ThisExpression") &&
    (!classNode || findEnclosingClass(receiver) === classNode);
  const isThisAlias = isNodeOfType(receiver, "Identifier") && thisAliasNames.has(receiver.name);
  if (!isClassThis && !isThisAlias) return null;
  if (isNodeOfType(candidate.property, "PrivateIdentifier")) {
    return `#${candidate.property.name}`;
  }
  return getStaticPropertyKeyName(candidate, { allowComputedString: true });
};
