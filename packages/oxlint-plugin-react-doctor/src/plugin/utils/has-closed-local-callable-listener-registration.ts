import { collectFunctionReturnStatements } from "./collect-function-return-statements.js";
import { EFFECT_HOOK_NAMES } from "../constants/react.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { functionReturnsMatchingExpression } from "./function-returns-matching-expression.js";
import { getDirectUnreassignedInitializer } from "./get-direct-unreassigned-initializer.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { isFunctionLike } from "./is-function-like.js";
import { isKeyedDraftTypeReference } from "./is-keyed-draft-type-reference.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isReactApiCall } from "./is-react-api-call.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { RuleContext } from "./rule-context.js";

const lexicalHazardsByAnalysis = new WeakMap<ScopeAnalysis, boolean>();

const hasUnsupportedLexicalRuntime = (scopes: ScopeAnalysis): boolean => {
  const cached = lexicalHazardsByAnalysis.get(scopes);
  if (cached !== undefined) return cached;
  let hazardous = false;
  walkAst(scopes.rootScope.node, (node) => {
    if (hazardous || isKeyedDraftTypeReference(node)) return false;
    if (isNodeOfType(node, "WithStatement")) hazardous = true;
    if (isNodeOfType(node, "CallExpression")) {
      const callee = stripParenExpression(node.callee);
      if (isNodeOfType(callee, "Identifier") && callee.name === "eval") hazardous = true;
    }
  });
  lexicalHazardsByAnalysis.set(scopes, hazardous);
  return hazardous;
};

const isClosedCallableReturnExpression = (expression: EsTreeNode): boolean => {
  const value = stripParenExpression(expression);
  if (isFunctionLike(value)) return true;
  if (isNodeOfType(value, "ConditionalExpression")) {
    return (
      isClosedCallableReturnExpression(value.consequent) &&
      isClosedCallableReturnExpression(value.alternate)
    );
  }
  return (
    isNodeOfType(value, "LogicalExpression") &&
    isClosedCallableReturnExpression(value.left) &&
    isClosedCallableReturnExpression(value.right)
  );
};

export const hasClosedLocalCallableListenerRegistration = (
  node: EsTreeNode,
  context: RuleContext,
): boolean => {
  if (!isNodeOfType(node, "CallExpression") || node.optional) return false;
  const callee = stripParenExpression(node.callee);
  if (
    !isNodeOfType(callee, "MemberExpression") ||
    callee.computed ||
    callee.optional ||
    !isNodeOfType(callee.property, "Identifier") ||
    callee.property.name !== "addListener"
  )
    return false;
  const receiver = stripParenExpression(callee.object);
  if (!isNodeOfType(receiver, "Identifier") || receiver.name !== "navigation") return false;
  const symbol = context.scopes.symbolFor(receiver);
  const initializer = symbol?.kind === "const" ? getDirectUnreassignedInitializer(symbol) : null;
  const object = initializer ? stripParenExpression(initializer) : null;
  if (!symbol || !isNodeOfType(object, "ObjectExpression")) return false;
  let hasRegistrationProperty = false;
  let registrationFunction: EsTreeNode | null = null;
  for (const property of object.properties) {
    if (!isNodeOfType(property, "Property") || property.kind !== "init" || property.computed)
      return false;
    const propertyName = getStaticPropertyKeyName(property);
    if (propertyName === null) return false;
    if (propertyName === "addListener") {
      if (hasRegistrationProperty) return false;
      hasRegistrationProperty = true;
      registrationFunction = stripParenExpression(property.value);
    }
  }
  if (
    !hasRegistrationProperty ||
    hasUnsupportedLexicalRuntime(context.scopes) ||
    !hasCompleteSymbolReferences(symbol, context.scopes.rootScope.node, context.scopes)
  )
    return false;
  const effectFunction = findEnclosingFunction(node);
  const effectCall = effectFunction ? findTransparentExpressionRoot(effectFunction).parent : null;
  if (
    !effectFunction ||
    !isNodeOfType(effectCall, "CallExpression") ||
    effectCall.optional ||
    !effectCall.arguments[0] ||
    stripParenExpression(effectCall.arguments[0]) !== effectFunction ||
    (!isReactApiCall(effectCall, EFFECT_HOOK_NAMES, context.scopes) &&
      !isReactApiCall(effectCall, "useInsertionEffect", context.scopes))
  )
    return false;
  const dependencies = effectCall.arguments[1]
    ? stripParenExpression(effectCall.arguments[1])
    : null;
  if (
    !symbol.references.every((reference) => {
      if (isKeyedDraftTypeReference(reference.identifier)) return true;
      if (reference.flag !== "read") return false;
      const referenceRoot = findTransparentExpressionRoot(reference.identifier);
      const parent = referenceRoot.parent;
      if (
        isNodeOfType(parent, "ArrayExpression") &&
        parent === dependencies &&
        parent.elements.some((element) => element === referenceRoot)
      )
        return true;
      if (
        !isNodeOfType(parent, "MemberExpression") ||
        parent.object !== referenceRoot ||
        parent.computed ||
        parent.optional ||
        !isNodeOfType(parent.property, "Identifier") ||
        parent.property.name !== "addListener"
      )
        return false;
      const memberRoot = findTransparentExpressionRoot(parent);
      const invocation = memberRoot.parent;
      return (
        isNodeOfType(invocation, "CallExpression") &&
        !invocation.optional &&
        invocation.callee === memberRoot
      );
    })
  )
    return false;
  const registration = registrationFunction;
  if (
    !registration ||
    !isFunctionLike(registration) ||
    registration.async ||
    registration.generator
  )
    return false;
  const returnedExpressions = isNodeOfType(registration.body, "BlockStatement")
    ? collectFunctionReturnStatements(registration).flatMap((statement) =>
        statement.argument ? [statement.argument] : [],
      )
    : [registration.body];
  if (!returnedExpressions.every(isClosedCallableReturnExpression)) return false;
  let hasImplicitReceiver = false;
  walkAst(registration, (child) => {
    if (hasImplicitReceiver || isKeyedDraftTypeReference(child)) return false;
    if (isNodeOfType(child, "ThisExpression") || isNodeOfType(child, "Super"))
      hasImplicitReceiver = true;
  });
  return (
    !hasImplicitReceiver &&
    functionReturnsMatchingExpression(
      registration,
      context.scopes,
      isFunctionLike,
      context.cfg,
      "every",
    )
  );
};
