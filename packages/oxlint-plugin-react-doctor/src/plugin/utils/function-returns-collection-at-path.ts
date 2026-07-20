import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import { collectFunctionReturnStatements } from "./collect-function-return-statements.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export interface FunctionReturnsCollectionAtPathInput {
  readonly collectionKind: "array" | "map-or-set";
  readonly functionNode: EsTreeNode;
  readonly propertyPath: readonly string[];
  readonly scopes: ScopeAnalysis;
}

const resolveImmutableInitializer = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number>,
): EsTreeNode => {
  const candidate = stripParenExpression(expression);
  if (!isNodeOfType(candidate, "Identifier")) return candidate;
  const symbol = scopes.symbolFor(candidate);
  if (
    symbol?.kind !== "const" ||
    !symbol.initializer ||
    visitedSymbolIds.has(symbol.id) ||
    symbol.references.some((reference) => reference.flag !== "read")
  ) {
    return candidate;
  }
  visitedSymbolIds.add(symbol.id);
  return resolveImmutableInitializer(symbol.initializer, scopes, visitedSymbolIds);
};

const expressionAtPropertyPath = (
  expression: EsTreeNode,
  propertyPath: readonly string[],
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number> = new Set(),
): EsTreeNode | null => {
  const candidate = resolveImmutableInitializer(expression, scopes, visitedSymbolIds);
  const [propertyName, ...remainingPath] = propertyPath;
  if (!propertyName) return candidate;
  if (!isNodeOfType(candidate, "ObjectExpression")) return null;
  for (const property of candidate.properties) {
    if (!isNodeOfType(property, "Property")) continue;
    if (getStaticPropertyKeyName(property) !== propertyName) continue;
    return expressionAtPropertyPath(property.value, remainingPath, scopes, visitedSymbolIds);
  }
  return null;
};

const isGlobalConstructor = (
  expression: EsTreeNode,
  constructorNames: ReadonlySet<string>,
  scopes: ScopeAnalysis,
): boolean => {
  const candidate = stripParenExpression(expression);
  return (
    isNodeOfType(candidate, "Identifier") &&
    constructorNames.has(candidate.name) &&
    scopes.isGlobalReference(candidate)
  );
};

const isCollectionExpression = (
  expression: EsTreeNode,
  collectionKind: FunctionReturnsCollectionAtPathInput["collectionKind"],
  scopes: ScopeAnalysis,
): boolean => {
  const candidate = stripParenExpression(expression);
  if (collectionKind === "array" && isNodeOfType(candidate, "ArrayExpression")) return true;
  if (!isNodeOfType(candidate, "NewExpression")) return false;
  return isGlobalConstructor(
    candidate.callee,
    collectionKind === "array" ? new Set(["Array"]) : new Set(["Map", "Set"]),
    scopes,
  );
};

export const functionReturnsCollectionAtPath = ({
  collectionKind,
  functionNode,
  propertyPath,
  scopes,
}: FunctionReturnsCollectionAtPathInput): boolean => {
  if (!isFunctionLike(functionNode)) return false;
  const returnedExpressions = isNodeOfType(functionNode.body, "BlockStatement")
    ? collectFunctionReturnStatements(functionNode).flatMap((returnStatement) =>
        returnStatement.argument ? [returnStatement.argument] : [],
      )
    : [functionNode.body];
  return (
    returnedExpressions.length > 0 &&
    returnedExpressions.every((returnedExpression) => {
      const collectionExpression = expressionAtPropertyPath(
        returnedExpression,
        propertyPath,
        scopes,
      );
      return Boolean(
        collectionExpression &&
        isCollectionExpression(collectionExpression, collectionKind, scopes),
      );
    })
  );
};
