import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import { collectConstAliasSymbols } from "./collect-const-alias-symbols.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { getDirectUnreassignedInitializer } from "./get-direct-unreassigned-initializer.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isWithinAssignmentTarget } from "./is-within-assignment-target.js";
import { resolveReactRefSymbol } from "./react-ref-origin.js";
import { stripParenExpression } from "./strip-paren-expression.js";

interface OwnedWriteBaseOptions {
  scopes: ScopeAnalysis;
  hasClosedBinding: (symbols: SymbolDescriptor[]) => boolean;
  isNativeRefCall: (node: EsTreeNode) => boolean;
  isDependencyEntry: (node: EsTreeNode) => boolean;
}

const isEmptyObject = (node: EsTreeNode): boolean => {
  const expression = stripParenExpression(node);
  return isNodeOfType(expression, "ObjectExpression") && expression.properties.length === 0;
};

export const createStateUpdaterOwnedWriteBaseInspector = ({
  scopes,
  hasClosedBinding,
  isNativeRefCall,
  isDependencyEntry,
}: OwnedWriteBaseOptions): ((receiver: EsTreeNode) => boolean) => {
  const refProofs = new Map<SymbolDescriptor, boolean>();

  const hasOwnedRefPayload = (member: EsTreeNode): boolean => {
    if (
      !isNodeOfType(member, "MemberExpression") ||
      member.optional ||
      getStaticPropertyName(member) !== "current"
    )
      return false;
    const symbol = resolveReactRefSymbol(member, scopes);
    if (!symbol) return false;
    const cached = refProofs.get(symbol);
    if (cached !== undefined) return cached;
    refProofs.set(symbol, false);
    const directInitializer = getDirectUnreassignedInitializer(symbol);
    const initializer = directInitializer ? stripParenExpression(directInitializer) : null;
    if (
      symbol.kind !== "const" ||
      !isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
      symbol.declarationNode.init !== directInitializer ||
      !isFunctionLike(symbol.scope.node) ||
      !initializer ||
      !isNodeOfType(initializer, "CallExpression") ||
      !isNativeRefCall(initializer) ||
      initializer.arguments.length !== 1 ||
      !isEmptyObject(initializer.arguments[0])
    )
      return false;
    const aliases = collectConstAliasSymbols(symbol, scopes);
    if (!hasClosedBinding(aliases)) return false;
    for (const alias of aliases) {
      for (const reference of alias.references) {
        const root = findTransparentExpressionRoot(reference.identifier);
        const parent = root.parent;
        if (
          isNodeOfType(parent, "VariableDeclarator") &&
          parent.init === root &&
          isNodeOfType(parent.id, "Identifier") &&
          aliases.some((candidate) => candidate === scopes.symbolFor(parent.id))
        )
          continue;
        if (isDependencyEntry(reference.identifier)) continue;
        if (
          !isNodeOfType(parent, "MemberExpression") ||
          parent.object !== root ||
          parent.optional ||
          getStaticPropertyName(parent) !== "current"
        )
          return false;
        const current = findTransparentExpressionRoot(parent);
        const consumer = current.parent;
        if (isNodeOfType(consumer, "MemberExpression") && consumer.object === current) continue;
        if (
          isWithinAssignmentTarget(current) &&
          !(
            isNodeOfType(consumer, "AssignmentExpression") &&
            consumer.left === current &&
            consumer.operator === "=" &&
            isEmptyObject(consumer.right)
          )
        )
          return false;
      }
    }
    refProofs.set(symbol, true);
    return true;
  };

  const hasOwnedBase = (receiver: EsTreeNode, visited = new Set<SymbolDescriptor>()): boolean => {
    const expression = stripParenExpression(receiver);
    if (isEmptyObject(expression)) return true;
    if (isNodeOfType(expression, "MemberExpression")) return hasOwnedRefPayload(expression);
    if (!isNodeOfType(expression, "Identifier")) return false;
    const symbol = scopes.symbolFor(expression);
    if (
      !symbol ||
      visited.has(symbol) ||
      !["const", "let"].includes(symbol.kind) ||
      !isFunctionLike(symbol.scope.node) ||
      !hasClosedBinding([symbol])
    )
      return false;
    const initializer = getDirectUnreassignedInitializer(symbol);
    if (
      !initializer ||
      !isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
      symbol.declarationNode.init !== initializer
    )
      return false;
    visited.add(symbol);
    return hasOwnedBase(initializer, visited);
  };

  return (receiver) => hasOwnedBase(receiver);
};
