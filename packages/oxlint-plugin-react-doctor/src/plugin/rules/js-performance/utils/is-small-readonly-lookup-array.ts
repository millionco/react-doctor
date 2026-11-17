import { SMALL_LITERAL_ARRAY_MAX_ELEMENTS } from "../../../constants/thresholds.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { getResolvedStaticPropertyName } from "../../../utils/get-resolved-static-property-name.js";
import { isAllLiteralArrayExpression } from "../../../utils/is-all-literal-array-expression.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import {
  isProvenGlobalNamespaceReference,
  isProvenGlobalObjectReference,
} from "../../../utils/is-proven-global-namespace-reference.js";
import { isSymbolReadOnly } from "../../../utils/is-symbol-read-only.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";

const uncertaintyByScopes = new WeakMap<ScopeAnalysis, boolean>();
const smallLookupArrayBySymbol = new WeakMap<SymbolDescriptor, boolean>();

const hasNativeArrayUncertainty = (scopes: ScopeAnalysis): boolean => {
  const cached = uncertaintyByScopes.get(scopes);
  if (cached !== undefined) return cached;
  let uncertain = false;
  walkAst(scopes.rootScope.node, (node) => {
    if (uncertain || isTypeScriptTypePosition(node)) return false;
    if (node.type === "WithStatement") {
      uncertain = true;
      return false;
    }
    if (isNodeOfType(node, "CallExpression")) {
      const callee = stripParenExpression(node.callee);
      if (isNodeOfType(callee, "Identifier") && callee.name === "eval") {
        uncertain = true;
        return false;
      }
    }
    if (!isNodeOfType(node, "Identifier") && !isNodeOfType(node, "MemberExpression")) return;
    const propertyName = isNodeOfType(node, "MemberExpression")
      ? getResolvedStaticPropertyName(node, scopes)
      : null;
    if (
      isProvenGlobalNamespaceReference(node, "eval", scopes) ||
      isProvenGlobalNamespaceReference(node, "Function", scopes)
    ) {
      uncertain = true;
      return false;
    }
    if (isNodeOfType(node, "MemberExpression")) {
      if (
        propertyName === "prototype" ||
        propertyName === "__proto__" ||
        propertyName === "constructor" ||
        ((propertyName === "eval" || propertyName === "Function") &&
          isProvenGlobalObjectReference(node.object, scopes)) ||
        (propertyName === "getPrototypeOf" &&
          (isProvenGlobalNamespaceReference(node.object, "Object", scopes) ||
            isProvenGlobalNamespaceReference(node.object, "Reflect", scopes))) ||
        (propertyName === null &&
          isNodeOfType(stripParenExpression(node.object), "ArrayExpression"))
      ) {
        uncertain = true;
        return false;
      }
    }
    if (
      !isProvenGlobalNamespaceReference(node, "Array", scopes) &&
      !isProvenGlobalNamespaceReference(node, "Object", scopes) &&
      !isProvenGlobalNamespaceReference(node, "Reflect", scopes) &&
      !(
        isNodeOfType(node, "MemberExpression") &&
        isProvenGlobalObjectReference(node.object, scopes) &&
        (propertyName === "Array" || propertyName === "Object" || propertyName === "Reflect")
      )
    ) {
      return;
    }
    const root = findTransparentExpressionRoot(node);
    const consumer = root.parent;
    if (
      (isNodeOfType(consumer, "MemberExpression") &&
        consumer.object === root &&
        getResolvedStaticPropertyName(consumer, scopes) !== null) ||
      (isNodeOfType(consumer, "BinaryExpression") &&
        consumer.operator === "instanceof" &&
        consumer.right === root) ||
      (isNodeOfType(consumer, "CallExpression") && consumer.callee === root) ||
      (isNodeOfType(consumer, "NewExpression") && consumer.callee === root)
    ) {
      return;
    }
    uncertain = true;
    return false;
  });
  uncertaintyByScopes.set(scopes, uncertain);
  return uncertain;
};

const isPureLookupOperand = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const expression = stripParenExpression(node);
  if (isNodeOfType(expression, "Identifier")) return scopes.symbolFor(expression) !== null;
  return (
    isNodeOfType(expression, "Literal") &&
    (typeof expression.value === "string" ||
      typeof expression.value === "number" ||
      typeof expression.value === "boolean")
  );
};

const isPureLookupPredicate = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const predicate = stripParenExpression(node);
  if (!isNodeOfType(predicate, "ArrowFunctionExpression") || predicate.async) return false;
  const [parameter, ...otherParameters] = predicate.params;
  if (!isNodeOfType(parameter, "Identifier") || otherParameters.length > 0) return false;
  const body = stripParenExpression(predicate.body);
  if (
    !isNodeOfType(body, "BinaryExpression") ||
    (body.operator !== "===" && body.operator !== "!==")
  ) {
    return false;
  }
  const parameterSymbol = scopes.symbolFor(parameter);
  if (!parameterSymbol) return false;
  const left = stripParenExpression(body.left);
  const right = stripParenExpression(body.right);
  return (
    (isNodeOfType(left, "Identifier") &&
      scopes.symbolFor(left) === parameterSymbol &&
      isPureLookupOperand(right, scopes)) ||
    (isNodeOfType(right, "Identifier") &&
      scopes.symbolFor(right) === parameterSymbol &&
      isPureLookupOperand(left, scopes))
  );
};

const isSafeLookupReference = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const receiver = findTransparentExpressionRoot(node);
  const member = receiver.parent;
  if (
    !isNodeOfType(member, "MemberExpression") ||
    member.object !== receiver ||
    member.computed ||
    member.optional ||
    !isNodeOfType(member.property, "Identifier") ||
    (member.property.name !== "find" && member.property.name !== "findIndex")
  ) {
    return false;
  }
  const call = member.parent;
  if (!isNodeOfType(call, "CallExpression") || call.callee !== member || call.optional)
    return false;
  const [predicate, ...otherArguments] = call.arguments;
  return Boolean(
    predicate && otherArguments.length === 0 && isPureLookupPredicate(predicate, scopes),
  );
};

export const isSmallReadonlyLookupArray = (
  node: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isNodeOfType(node.callee, "MemberExpression")) return false;
  const receiver = stripParenExpression(node.callee.object);
  if (!isNodeOfType(receiver, "Identifier")) return false;
  const symbol = scopes.symbolFor(receiver);
  if (!symbol) return false;
  const cached = smallLookupArrayBySymbol.get(symbol);
  if (cached !== undefined) return cached;
  const initializer = getDirectConstInitializer(symbol);
  const array = initializer ? stripParenExpression(initializer) : null;
  const result = Boolean(
    array &&
    isNodeOfType(array, "ArrayExpression") &&
    array.elements.length <= SMALL_LITERAL_ARRAY_MAX_ELEMENTS &&
    isAllLiteralArrayExpression(array) &&
    findEnclosingFunction(symbol.declarationNode) &&
    isSymbolReadOnly(symbol) &&
    symbol.references.every((reference) => isSafeLookupReference(reference.identifier, scopes)) &&
    !hasNativeArrayUncertainty(scopes),
  );
  smallLookupArrayBySymbol.set(symbol, result);
  return result;
};
