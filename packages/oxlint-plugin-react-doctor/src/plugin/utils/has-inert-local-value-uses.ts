import type { EsTreeNode } from "./es-tree-node.js";
import type { RuleContext } from "./rule-context.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { hasReliableMatcherSymbolReferences } from "./has-reliable-matcher-symbol-references.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isErasedMatcherReference } from "./is-erased-matcher-reference.js";

interface InertLocalValueUsesInput {
  readonly value: EsTreeNode;
  readonly context: RuleContext;
  readonly allowExport?: boolean;
}

export const hasInertLocalValueUses = ({
  value,
  context,
  allowExport = false,
}: InertLocalValueUsesInput): boolean => {
  const root = findTransparentExpressionRoot(value);
  const consumer = root.parent;
  if (isNodeOfType(consumer, "ExpressionStatement")) return true;
  if (allowExport && isNodeOfType(consumer, "ExportDefaultDeclaration")) return true;
  if (
    !isNodeOfType(consumer, "VariableDeclarator") ||
    consumer.init !== root ||
    !isNodeOfType(consumer.id, "Identifier")
  )
    return false;
  const symbol = context.scopes.symbolFor(consumer.id);
  return Boolean(
    symbol?.kind === "const" &&
    hasReliableMatcherSymbolReferences(symbol, context.scopes.rootScope.node, context.scopes) &&
    symbol.references.every((reference) => {
      if (reference.flag !== "read") return false;
      if (isErasedMatcherReference(reference.identifier)) return true;
      const identifier = findTransparentExpressionRoot(reference.identifier);
      const parent = identifier.parent;
      return (
        (isNodeOfType(parent, "UnaryExpression") &&
          (parent.operator === "typeof" || parent.operator === "void")) ||
        (allowExport && isNodeOfType(parent, "ExportSpecifier") && parent.local === identifier)
      );
    }),
  );
};
