import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findVisibleSymbol } from "../../../utils/find-visible-symbol.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getSingleReturnExpression } from "../../../utils/get-single-return-expression.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { getStaticKeyName } from "../../../utils/get-static-key-name.js";
import { getSymbolTypeAnnotation } from "../../../utils/get-symbol-type-annotation.js";
import { hasPossibleStaticPropertyMutationOrEscape } from "../../../utils/has-static-property-write-before.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isProvenPromiseExpression } from "../../../utils/is-proven-promise-expression.js";
import { isProvenUnmodifiedGlobalNamespaceReference } from "../../../utils/is-proven-unmodified-global-namespace-reference.js";
import { isSymbolReadOnly } from "../../../utils/is-symbol-read-only.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { resolveExactLocalFunction } from "../../../utils/resolve-exact-local-function.js";
import { resolveImportedApiReference } from "../../../utils/resolve-imported-api-reference.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";

const promiseNamespaceIsUnmodifiedByAnalysis = new WeakMap<ScopeAnalysis, boolean>();

const hasUnmodifiedPromiseNamespace = (scopes: ScopeAnalysis): boolean => {
  const cachedIsUnmodified = promiseNamespaceIsUnmodifiedByAnalysis.get(scopes);
  if (cachedIsUnmodified !== undefined) return cachedIsUnmodified;
  const pendingScopes = [scopes.rootScope];
  while (pendingScopes.length > 0) {
    const scope = pendingScopes.pop();
    if (!scope) break;
    pendingScopes.push(...scope.children);
    for (const reference of scope.references) {
      const identifier = reference.identifier;
      if (!isNodeOfType(identifier, "Identifier") || !scopes.isGlobalReference(identifier))
        continue;
      if (
        identifier.name === "Promise" &&
        !isProvenUnmodifiedGlobalNamespaceReference(identifier, "Promise", scopes, undefined, true)
      ) {
        promiseNamespaceIsUnmodifiedByAnalysis.set(scopes, false);
        return false;
      }
      if (
        ["globalThis", "window", "self", "global"].includes(identifier.name) &&
        !isProvenUnmodifiedGlobalNamespaceReference(identifier, null, scopes, "Promise", true)
      ) {
        promiseNamespaceIsUnmodifiedByAnalysis.set(scopes, false);
        return false;
      }
    }
  }
  promiseNamespaceIsUnmodifiedByAnalysis.set(scopes, true);
  return true;
};

export const isSubscriptionPromise = (
  rawExpression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedFunctions = new Set<EsTreeNode>(),
): boolean => {
  if (!hasUnmodifiedPromiseNamespace(scopes)) return false;
  const expression = stripParenExpression(rawExpression);
  if (
    isNodeOfType(expression, "Identifier") &&
    ["then", "catch", "finally", "constructor"].some((propertyName) =>
      hasPossibleStaticPropertyMutationOrEscape(expression, propertyName, scopes),
    )
  ) {
    return false;
  }
  const callee = isNodeOfType(expression, "CallExpression")
    ? stripParenExpression(expression.callee)
    : null;
  if (
    isNodeOfType(callee, "MemberExpression") &&
    ["then", "catch", "finally"].includes(getStaticPropertyName(callee) ?? "")
  ) {
    return isSubscriptionPromise(callee.object, scopes, visitedFunctions);
  }
  if (isProvenPromiseExpression(rawExpression, scopes, { requireUnmodifiedGlobalPromise: true })) {
    return true;
  }
  if (!isNodeOfType(expression, "CallExpression")) return false;
  const producer = resolveExactLocalFunction(expression.callee, scopes);
  if (producer && isFunctionLike(producer)) {
    if (visitedFunctions.has(producer) || producer.generator) return false;
    if (producer.async) return true;
    const returned = getSingleReturnExpression(producer);
    if (!returned) return false;
    const nextVisitedFunctions = new Set(visitedFunctions);
    nextVisitedFunctions.add(producer);
    return isSubscriptionPromise(returned, scopes, nextVisitedFunctions);
  }
  if (!isNodeOfType(callee, "MemberExpression") || callee.computed) return false;
  const methodName = getStaticPropertyName(callee);
  const receiver = stripParenExpression(callee.object);
  if (!methodName || !isNodeOfType(receiver, "Identifier")) return false;
  const receiverSymbol = scopes.symbolFor(receiver);
  if (
    !receiverSymbol ||
    !isSymbolReadOnly(receiverSymbol) ||
    !receiverSymbol.references.every((reference) => {
      const referenceRoot = findTransparentExpressionRoot(reference.identifier);
      const parent = referenceRoot.parent;
      return (
        isNodeOfType(parent, "MemberExpression") &&
        parent.object === referenceRoot &&
        !isWithinAssignmentTarget(reference.identifier)
      );
    }) ||
    hasPossibleStaticPropertyMutationOrEscape(receiver, methodName, scopes)
  ) {
    return false;
  }
  const importedApi = resolveImportedApiReference(receiver, scopes);
  if (
    importedApi?.source === "expo-sensors" &&
    importedApi.importedName === "Accelerometer" &&
    methodName === "isAvailableAsync"
  ) {
    return true;
  }
  const declaration = receiverSymbol.declarationNode;
  if (
    !isNodeOfType(declaration, "VariableDeclarator") ||
    declaration.init ||
    !isNodeOfType(declaration.parent, "VariableDeclaration") ||
    !declaration.parent.declare
  ) {
    return false;
  }
  const annotation = getSymbolTypeAnnotation(receiverSymbol);
  if (!isNodeOfType(annotation, "TSTypeLiteral")) return false;
  const [member, ...overloads] = annotation.members.filter(
    (candidate) =>
      (isNodeOfType(candidate, "TSPropertySignature") ||
        isNodeOfType(candidate, "TSMethodSignature")) &&
      !candidate.computed &&
      getStaticKeyName(candidate.key) === methodName,
  );
  if (overloads.length > 0) return false;
  const functionType = isNodeOfType(member, "TSPropertySignature")
    ? member.typeAnnotation?.typeAnnotation
    : member;
  const returnType =
    isNodeOfType(functionType, "TSFunctionType") || isNodeOfType(functionType, "TSMethodSignature")
      ? functionType.returnType?.typeAnnotation
      : null;
  if (
    !isNodeOfType(returnType, "TSTypeReference") ||
    !isNodeOfType(returnType.typeName, "Identifier") ||
    returnType.typeName.name !== "Promise" ||
    findVisibleSymbol(returnType.typeName, scopes)
  ) {
    return false;
  }
  let ancestor: EsTreeNode | null | undefined = returnType;
  while (ancestor) {
    if (
      "typeParameters" in ancestor &&
      isNodeOfType(ancestor.typeParameters, "TSTypeParameterDeclaration") &&
      ancestor.typeParameters.params.some((parameter) => parameter.name.name === "Promise")
    ) {
      return false;
    }
    ancestor = ancestor.parent;
  }
  return true;
};
