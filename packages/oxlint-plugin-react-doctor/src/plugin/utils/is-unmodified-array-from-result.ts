import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getDirectConstInitializer } from "./get-direct-const-initializer.js";
import { getStaticArrayLikeLength } from "./get-static-array-like-length.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isProvenGlobalNamespaceReference } from "./is-proven-global-namespace-reference.js";
import { isSynchronousIteratorCall } from "./is-synchronous-iterator-callback.js";
import { stripParenExpression } from "./strip-paren-expression.js";

const stableArrayNamespaceByAnalysis = new WeakMap<ScopeAnalysis, boolean>();

const arrayNamespaceHasOnlyFactoryReads = (scopes: ScopeAnalysis): boolean => {
  const cached = stableArrayNamespaceByAnalysis.get(scopes);
  if (cached !== undefined) return cached;
  const pendingScopes = [scopes.rootScope];
  while (pendingScopes.length > 0) {
    const scope = pendingScopes.pop();
    if (!scope) break;
    pendingScopes.push(...scope.children);
    for (const reference of scope.references) {
      let expression = findTransparentExpressionRoot(reference.identifier);
      while (true) {
        if (isProvenGlobalNamespaceReference(expression, "Array", scopes)) {
          const member = expression.parent;
          const call = member && findTransparentExpressionRoot(member).parent;
          if (
            reference.flag !== "read" ||
            !isNodeOfType(member, "MemberExpression") ||
            member.object !== expression ||
            !["from", "of", "isArray"].includes(getStaticPropertyName(member) ?? "") ||
            !isNodeOfType(call, "CallExpression") ||
            stripParenExpression(call.callee) !== member
          ) {
            stableArrayNamespaceByAnalysis.set(scopes, false);
            return false;
          }
        }
        const parent = expression.parent;
        if (!isNodeOfType(parent, "MemberExpression") || parent.object !== expression) break;
        expression = findTransparentExpressionRoot(parent);
      }
    }
  }
  stableArrayNamespaceByAnalysis.set(scopes, true);
  return true;
};

export const isUnmodifiedArrayFromResult = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const receiver = stripParenExpression(expression);
  if (!isNodeOfType(receiver, "Identifier")) return false;
  const symbol = scopes.symbolFor(receiver);
  const initializer = symbol && getDirectConstInitializer(symbol);
  if (!symbol || !initializer) return false;
  const factoryCall = stripParenExpression(initializer);
  if (!isNodeOfType(factoryCall, "CallExpression") || factoryCall.arguments.length !== 1)
    return false;
  const source = stripParenExpression(factoryCall.arguments[0]);
  const sourceSymbol = isNodeOfType(source, "Identifier") ? scopes.symbolFor(source) : null;
  const sourceIsUnsharedParameter =
    sourceSymbol?.kind === "parameter" &&
    sourceSymbol.references.length === 1 &&
    sourceSymbol.references.every((reference) => reference.flag === "read");
  const sourceArrayLength = isNodeOfType(source, "ArrayExpression")
    ? getStaticArrayLikeLength(source, scopes)
    : null;
  if (!sourceIsUnsharedParameter && (sourceArrayLength === null || sourceArrayLength === 0))
    return false;
  const factory = stripParenExpression(factoryCall.callee);
  if (
    !isNodeOfType(factory, "MemberExpression") ||
    getStaticPropertyName(factory) !== "from" ||
    !isProvenGlobalNamespaceReference(factory.object, "Array", scopes) ||
    !arrayNamespaceHasOnlyFactoryReads(scopes)
  )
    return false;
  return symbol.references.every((reference) => {
    if (reference.flag !== "read") return false;
    const referenceRoot = findTransparentExpressionRoot(reference.identifier);
    const member = referenceRoot.parent;
    if (!isNodeOfType(member, "MemberExpression") || member.object !== referenceRoot) return false;
    const memberRoot = findTransparentExpressionRoot(member);
    const consumer = memberRoot.parent;
    const propertyName = getStaticPropertyName(member);
    if (propertyName === "length") return isNodeOfType(consumer, "BinaryExpression");
    if (
      propertyName !== "map" ||
      !isNodeOfType(consumer, "CallExpression") ||
      consumer.callee !== memberRoot ||
      consumer.arguments.length !== 1
    )
      return false;
    const callback = stripParenExpression(consumer.arguments[0]);
    return (
      isNodeOfType(callback, "ArrowFunctionExpression") &&
      !callback.async &&
      callback.params.length <= 2 &&
      callback.params.every((parameter) => !isNodeOfType(parameter, "RestElement")) &&
      isSynchronousIteratorCall(consumer, consumer.arguments[0], scopes)
    );
  });
};
