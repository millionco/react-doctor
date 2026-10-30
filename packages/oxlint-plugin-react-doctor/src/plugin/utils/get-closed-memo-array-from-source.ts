import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getDirectConstInitializer } from "./get-direct-const-initializer.js";
import { getImportedName } from "./get-imported-name.js";
import { getSingleReturnExpression } from "./get-single-return-expression.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { hasClosedMemoProviderIntegrity } from "./has-closed-memo-provider-integrity.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isProvenUnmodifiedGlobalNamespaceReference } from "./is-proven-unmodified-global-namespace-reference.js";
import { isReactApiCall } from "./is-react-api-call.js";
import { stripParenExpression } from "./strip-paren-expression.js";

const closedMemoUsesBySymbol = new WeakMap<SymbolDescriptor, boolean>();
const readonlyParameterUsesBySymbol = new WeakMap<SymbolDescriptor, boolean>();

export const getClosedMemoArrayFromSource = (
  iteratorCall: EsTreeNode,
  scopes: ScopeAnalysis,
): EsTreeNode | null => {
  if (
    !isNodeOfType(iteratorCall, "CallExpression") ||
    !isNodeOfType(iteratorCall.callee, "MemberExpression") ||
    getStaticPropertyName(iteratorCall.callee) !== "map"
  )
    return null;
  const callback = iteratorCall.arguments[0];
  if (
    iteratorCall.arguments.length !== 1 ||
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    callback.params.length > 2 ||
    callback.params.some((parameter) => !isNodeOfType(parameter, "Identifier"))
  )
    return null;
  const receiver = stripParenExpression(iteratorCall.callee.object);
  if (!isNodeOfType(receiver, "Identifier")) return null;
  const symbol = scopes.symbolFor(receiver);
  if (
    !symbol ||
    symbol.references.length !== 1 ||
    symbol.references[0]?.identifier !== receiver ||
    symbol.references[0].flag !== "read"
  )
    return null;
  const initializer = getDirectConstInitializer(symbol);
  if (!initializer) return null;
  const memoCall = stripParenExpression(initializer);
  if (
    !isNodeOfType(memoCall, "CallExpression") ||
    memoCall.arguments.length !== 2 ||
    !isNodeOfType(memoCall.callee, "Identifier") ||
    !isReactApiCall(memoCall, "useMemo", scopes)
  )
    return null;
  const memoSymbol = scopes.symbolFor(memoCall.callee);
  const memoImport = memoSymbol?.declarationNode.parent;
  if (
    !memoSymbol ||
    !isNodeOfType(memoSymbol.declarationNode, "ImportSpecifier") ||
    memoSymbol.declarationNode.importKind === "type" ||
    getImportedName(memoSymbol.declarationNode) !== "useMemo" ||
    !isNodeOfType(memoImport, "ImportDeclaration") ||
    memoImport.importKind === "type" ||
    memoImport.source.value !== "react"
  )
    return null;
  let hasClosedMemoUses = closedMemoUsesBySymbol.get(memoSymbol);
  if (hasClosedMemoUses === undefined) {
    hasClosedMemoUses = memoSymbol.references.every(
      (reference) =>
        reference.flag === "read" &&
        isNodeOfType(reference.identifier.parent, "CallExpression") &&
        reference.identifier.parent.callee === reference.identifier,
    );
    closedMemoUsesBySymbol.set(memoSymbol, hasClosedMemoUses);
  }
  if (!hasClosedMemoUses) return null;
  const factory = stripParenExpression(memoCall.arguments[0]);
  if (
    (!isNodeOfType(factory, "ArrowFunctionExpression") &&
      !isNodeOfType(factory, "FunctionExpression")) ||
    factory.async ||
    factory.generator ||
    factory.params.length !== 0
  )
    return null;
  const returnedExpression = getSingleReturnExpression(factory);
  if (!returnedExpression) return null;
  const arrayCall = stripParenExpression(returnedExpression);
  if (
    !isNodeOfType(arrayCall, "CallExpression") ||
    arrayCall.arguments.length !== 1 ||
    !isNodeOfType(arrayCall.callee, "MemberExpression") ||
    getStaticPropertyName(arrayCall.callee) !== "from" ||
    !isProvenUnmodifiedGlobalNamespaceReference(arrayCall.callee.object, "Array", scopes, "from")
  )
    return null;
  const source = stripParenExpression(arrayCall.arguments[0]);
  const dependencies = stripParenExpression(memoCall.arguments[1]);
  if (
    !isNodeOfType(source, "Identifier") ||
    !isNodeOfType(dependencies, "ArrayExpression") ||
    dependencies.elements.length !== 1
  )
    return null;
  const dependency = dependencies.elements[0];
  const sourceSymbol = scopes.symbolFor(source);
  if (
    !dependency ||
    !isNodeOfType(dependency, "Identifier") ||
    !sourceSymbol ||
    sourceSymbol.kind !== "parameter" ||
    sourceSymbol.scope.parent !== scopes.rootScope ||
    sourceSymbol.initializer ||
    scopes.symbolFor(dependency) !== sourceSymbol
  )
    return null;
  let hasReadonlyParameterUses = readonlyParameterUsesBySymbol.get(sourceSymbol);
  if (hasReadonlyParameterUses === undefined) {
    hasReadonlyParameterUses = sourceSymbol.references.every(
      (reference) => reference.flag === "read",
    );
    readonlyParameterUsesBySymbol.set(sourceSymbol, hasReadonlyParameterUses);
  }
  if (!hasReadonlyParameterUses) return null;
  let ancestor = sourceSymbol.bindingIdentifier.parent;
  while (ancestor) {
    if ("typeParameters" in ancestor && ancestor.typeParameters) return null;
    ancestor = ancestor.parent;
  }
  return hasClosedMemoProviderIntegrity(scopes) ? source : null;
};
