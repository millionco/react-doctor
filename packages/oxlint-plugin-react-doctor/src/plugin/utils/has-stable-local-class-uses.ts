import type { SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { RuleContext } from "./rule-context.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getEquivalentSymbols } from "./get-equivalent-symbols.js";
import { getStableReactClassConsumerName } from "./get-stable-react-class-consumer-name.js";
import { hasStableReactNamespaceProviders } from "./has-stable-react-namespace-providers.js";
import { hasInertLocalValueUses } from "./has-inert-local-value-uses.js";
import { hasNoOpaqueReactRef } from "./has-no-opaque-react-ref.js";
import { hasReliableMatcherSymbolReferences } from "./has-reliable-matcher-symbol-references.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isErasedMatcherReference } from "./is-erased-matcher-reference.js";

interface StableLocalClassUsesInput {
  readonly classNode: EsTreeNode | null | undefined;
  readonly context: RuleContext;
}

export const hasStableLocalClassUses = ({
  classNode,
  context,
}: StableLocalClassUsesInput): boolean => {
  if (!isNodeOfType(classNode, "ClassDeclaration") && !isNodeOfType(classNode, "ClassExpression"))
    return false;
  if (!hasStableReactNamespaceProviders(context)) return false;
  const bindings: EsTreeNode[] = [];
  if (classNode.id) bindings.push(classNode.id);
  const classRoot = findTransparentExpressionRoot(classNode);
  const owner = classRoot.parent;
  if (
    isNodeOfType(owner, "VariableDeclarator") &&
    owner.init === classRoot &&
    isNodeOfType(owner.id, "Identifier")
  )
    bindings.push(owner.id);
  if (!bindings.length) return isNodeOfType(owner, "ExportDefaultDeclaration");
  const visitedSymbols = new Set<SymbolDescriptor>();
  for (const binding of bindings) {
    const aliases = getEquivalentSymbols(binding, context.scopes);
    if (!aliases.length) return false;
    const aliasSymbols = new Set(aliases);
    for (const symbol of aliases) {
      if (visitedSymbols.has(symbol)) continue;
      visitedSymbols.add(symbol);
      if (
        !hasReliableMatcherSymbolReferences(symbol, context.scopes.rootScope.node, context.scopes)
      )
        return false;
      referenceLoop: for (const reference of symbol.references) {
        if (reference.flag !== "read") return false;
        if (isErasedMatcherReference(reference.identifier)) continue;
        let value = findTransparentExpressionRoot(reference.identifier);
        let isMemoResult = false;
        while (true) {
          const consumer = value.parent;
          if (
            isNodeOfType(consumer, "VariableDeclarator") &&
            consumer.init === value &&
            isNodeOfType(consumer.id, "Identifier")
          ) {
            const alias = context.scopes.symbolFor(consumer.id);
            if (alias?.kind !== "const") return false;
            if (isMemoResult) bindings.push(consumer.id);
            else if (!aliasSymbols.has(alias)) return false;
            continue referenceLoop;
          }
          if (
            (isNodeOfType(consumer, "ExportDefaultDeclaration") &&
              consumer.declaration === value) ||
            (isNodeOfType(consumer, "ExportSpecifier") && consumer.local === value) ||
            (isNodeOfType(consumer, "UnaryExpression") &&
              (consumer.operator === "typeof" || consumer.operator === "void"))
          )
            continue referenceLoop;
          if (isNodeOfType(consumer, "NewExpression") && consumer.callee === value) {
            if (!hasInertLocalValueUses({ value: consumer, context })) return false;
            continue referenceLoop;
          }
          if (
            (isNodeOfType(consumer, "JSXOpeningElement") ||
              isNodeOfType(consumer, "JSXClosingElement")) &&
            consumer.name === value
          ) {
            if (
              isNodeOfType(consumer, "JSXOpeningElement") &&
              (!hasNoOpaqueReactRef(consumer, context.scopes) ||
                !isNodeOfType(consumer.parent, "JSXElement") ||
                !hasInertLocalValueUses({ value: consumer.parent, context, allowExport: true }))
            )
              return false;
            continue referenceLoop;
          }
          if (isMemoResult && isNodeOfType(consumer, "ExpressionStatement")) continue referenceLoop;
          const [componentArgument] = isNodeOfType(consumer, "CallExpression")
            ? consumer.arguments
            : [];
          if (!isNodeOfType(consumer, "CallExpression") || componentArgument !== value)
            return false;
          const name = getStableReactClassConsumerName(consumer, context);
          if (name === "createElement") {
            if (
              !hasNoOpaqueReactRef(consumer, context.scopes) ||
              !hasInertLocalValueUses({ value: consumer, context, allowExport: true })
            )
              return false;
            continue referenceLoop;
          }
          if (name !== "memo") return false;
          value = findTransparentExpressionRoot(consumer);
          isMemoResult = true;
        }
      }
    }
  }
  return true;
};
