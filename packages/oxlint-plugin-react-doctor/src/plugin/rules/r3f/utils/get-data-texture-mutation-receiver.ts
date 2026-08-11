import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { resolveReactRefSymbol } from "../../../utils/react-ref-origin.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { getThreeConstructorName } from "./get-three-constructor-name.js";

const DATA_TEXTURE_CONSTRUCTOR_NAMES: ReadonlySet<string> = new Set([
  "Data3DTexture",
  "DataArrayTexture",
  "DataTexture",
]);
const TYPED_ARRAY_MUTATION_METHOD_NAMES: ReadonlySet<string> = new Set([
  "copyWithin",
  "fill",
  "reverse",
  "set",
  "sort",
]);

export const resolvesToDataTexture = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  managedDataTextureRefSymbolIds: ReadonlySet<number> = new Set(),
): boolean => {
  const candidate = stripParenExpression(expression);
  const refSymbol = resolveReactRefSymbol(candidate, scopes, {
    includeCreateRef: true,
    resolveNamedAliases: true,
  });
  return Boolean(
    (refSymbol && managedDataTextureRefSymbolIds.has(refSymbol.id)) ||
    DATA_TEXTURE_CONSTRUCTOR_NAMES.has(getThreeConstructorName(candidate, scopes) ?? ""),
  );
};

const resolveDataTextureFromDataExpression = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  managedDataTextureRefSymbolIds: ReadonlySet<number>,
  visitedSymbolIds: Set<number> = new Set(),
): EsTreeNode | null => {
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "MemberExpression")) {
    const propertyName = getStaticPropertyName(candidate);
    if (propertyName === "data") {
      const image = stripParenExpression(candidate.object);
      if (
        isNodeOfType(image, "MemberExpression") &&
        getStaticPropertyName(image) === "image" &&
        resolvesToDataTexture(image.object, scopes, managedDataTextureRefSymbolIds)
      ) {
        return image.object;
      }
    }
  }
  if (!isNodeOfType(candidate, "Identifier")) return null;
  const symbol = scopes.symbolFor(candidate);
  if (
    symbol?.kind !== "const" ||
    !symbol.initializer ||
    visitedSymbolIds.has(symbol.id) ||
    !isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
    symbol.declarationNode.id !== symbol.bindingIdentifier
  ) {
    return null;
  }
  visitedSymbolIds.add(symbol.id);
  return resolveDataTextureFromDataExpression(
    symbol.initializer,
    scopes,
    managedDataTextureRefSymbolIds,
    visitedSymbolIds,
  );
};

const getAssignmentMutationReceiver = (
  targetExpression: EsTreeNode,
  scopes: ScopeAnalysis,
  managedDataTextureRefSymbolIds: ReadonlySet<number>,
): EsTreeNode | null => {
  const target = stripParenExpression(targetExpression);
  if (!isNodeOfType(target, "MemberExpression")) return null;
  if (getStaticPropertyName(target) === "image") {
    return resolvesToDataTexture(target.object, scopes, managedDataTextureRefSymbolIds)
      ? target.object
      : null;
  }
  const directDataReceiver = resolveDataTextureFromDataExpression(
    target,
    scopes,
    managedDataTextureRefSymbolIds,
  );
  if (directDataReceiver) return directDataReceiver;
  return target.computed
    ? resolveDataTextureFromDataExpression(target.object, scopes, managedDataTextureRefSymbolIds)
    : null;
};

export const getDataTextureMutationReceiver = (
  node: EsTreeNode,
  scopes: ScopeAnalysis,
  managedDataTextureRefSymbolIds: ReadonlySet<number> = new Set(),
): EsTreeNode | null => {
  if (isNodeOfType(node, "AssignmentExpression")) {
    return getAssignmentMutationReceiver(node.left, scopes, managedDataTextureRefSymbolIds);
  }
  if (isNodeOfType(node, "UpdateExpression")) {
    return getAssignmentMutationReceiver(node.argument, scopes, managedDataTextureRefSymbolIds);
  }
  if (!isNodeOfType(node, "CallExpression")) return null;
  const callee = stripParenExpression(node.callee);
  if (
    !isNodeOfType(callee, "MemberExpression") ||
    !TYPED_ARRAY_MUTATION_METHOD_NAMES.has(getStaticPropertyName(callee) ?? "")
  ) {
    return null;
  }
  return resolveDataTextureFromDataExpression(
    callee.object,
    scopes,
    managedDataTextureRefSymbolIds,
  );
};
