import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getDirectUnreassignedInitializer } from "./get-direct-unreassigned-initializer.js";
import { getEquivalentSymbols } from "./get-equivalent-symbols.js";
import { getStaticObjectPropertyValue } from "./get-static-object-property-value.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isStableLogicalReceiver } from "./is-stable-logical-receiver.js";
import { resolveConstIdentifierAlias } from "./resolve-const-identifier-alias.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export const hasStableLogicalDataProperty = (
  receiver: EsTreeNode,
  propertyName: string,
  scopes: ScopeAnalysis,
): boolean => {
  const object = stripParenExpression(receiver);
  const symbol = resolveConstIdentifierAlias(object, scopes);
  const initializer = symbol ? getDirectUnreassignedInitializer(symbol) : null;
  const objectInitializer = initializer ? stripParenExpression(initializer) : null;
  if (
    !isNodeOfType(objectInitializer, "ObjectExpression") ||
    !objectInitializer.properties.every(
      (property) => isNodeOfType(property, "Property") && property.kind === "init",
    ) ||
    !getStaticObjectPropertyValue(objectInitializer, propertyName) ||
    !isStableLogicalReceiver(object, scopes)
  )
    return false;
  return getEquivalentSymbols(object, scopes).every((equivalentSymbol) =>
    equivalentSymbol.references.every((reference) => {
      const member = findTransparentExpressionRoot(reference.identifier).parent;
      if (!isNodeOfType(member, "MemberExpression")) return true;
      const memberRoot = findTransparentExpressionRoot(member);
      const consumer = memberRoot.parent;
      return !(isNodeOfType(consumer, "CallExpression") && consumer.callee === memberRoot);
    }),
  );
};
