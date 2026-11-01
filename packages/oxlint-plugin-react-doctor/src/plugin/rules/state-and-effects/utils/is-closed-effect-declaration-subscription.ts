import { hasOnlyReadonlySymbolReferences } from "../../../utils/has-only-readonly-symbol-references.js";
import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import { areExpressionsStructurallyEqual } from "../../../utils/are-expressions-structurally-equal.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { getCallbackStatements } from "../../../utils/get-callback-statements.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isProvenGlobalObjectReference } from "../../../utils/is-proven-global-namespace-reference.js";
import { getGlobalRequireModuleSource } from "../../../utils/get-global-require-module-source.js";
import { getFunctionBindingSymbols } from "../../../utils/get-function-binding-symbols.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { getValueImportSource } from "../../../utils/get-value-import-declaration.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { walkAst } from "../../../utils/walk-ast.js";

interface ClosedEffectDeclarationSubscription {
  readonly handler: EsTreeNode;
  readonly effectCall: EsTreeNode;
  readonly effectBodyStatements: EsTreeNode[];
  readonly subscriptionCall: EsTreeNode;
  readonly stateDeclarator: EsTreeNode;
  readonly initializer: EsTreeNode;
  readonly setterArgument: EsTreeNode;
  readonly scopes: ScopeAnalysis;
}

const isNamedReactCall = (node: EsTreeNode, name: string, scopes: ScopeAnalysis): boolean => {
  if (!isNodeOfType(node, "CallExpression") || node.optional) return false;
  const callee = node.callee;
  if (!isNodeOfType(callee, "Identifier")) return false;
  const symbol = scopes.symbolFor(callee);
  return Boolean(
    symbol &&
    getValueImportSource(symbol) === "react" &&
    getImportedName(symbol.declarationNode) === name &&
    hasOnlyReadonlySymbolReferences(symbol) &&
    symbol.references.every(
      (reference) =>
        isNodeOfType(reference.identifier.parent, "CallExpression") &&
        reference.identifier.parent.callee === reference.identifier,
    ),
  );
};

const isPlainWindowListener = (
  node: EsTreeNode,
  method: string,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isNodeOfType(node, "CallExpression") || node.optional) return false;
  const callee = node.callee;
  if (
    !isNodeOfType(callee, "MemberExpression") ||
    callee.optional ||
    callee.computed ||
    !isNodeOfType(callee.property, "Identifier") ||
    callee.property.name !== method ||
    !isNodeOfType(callee.object, "Identifier") ||
    callee.object.name !== "window" ||
    !scopes.isGlobalReference(callee.object)
  ) {
    return false;
  }
  const [event, handler, ...extra] = node.arguments;
  return Boolean(
    isNodeOfType(event, "Literal") &&
    typeof event.value === "string" &&
    isNodeOfType(handler, "Identifier") &&
    extra.length === 0,
  );
};

const hasClosedWindowReferences = (
  scopes: ScopeAnalysis,
  registration: EsTreeNode,
  cleanup: EsTreeNode,
): boolean => {
  if (!isNodeOfType(registration, "CallExpression") || !isNodeOfType(cleanup, "CallExpression"))
    return false;
  const pendingScopes = [scopes.rootScope];
  while (pendingScopes.length > 0) {
    const scope = pendingScopes.pop();
    if (!scope) break;
    pendingScopes.push(...scope.children);
    for (const reference of scope.references) {
      const identifier = reference.identifier;
      if (
        !reference.resolvedSymbol &&
        isNodeOfType(identifier, "Identifier") &&
        [
          "module",
          "process",
          "React",
          "Function",
          "eval",
          "document",
          "Window",
          "EventTarget",
          "frames",
          "top",
          "parent",
          "opener",
        ].includes(identifier.name)
      )
        return false;
      if (!isProvenGlobalObjectReference(identifier, scopes)) continue;
      if (
        !isNodeOfType(identifier, "Identifier") ||
        identifier.name !== "window" ||
        !scopes.isGlobalReference(identifier)
      )
        return false;
      const root = findTransparentExpressionRoot(identifier);
      const member = root.parent;
      if (
        !isNodeOfType(member, "MemberExpression") ||
        member.object !== root ||
        member.optional ||
        isWithinAssignmentTarget(member)
      )
        return false;
      const property = getStaticPropertyName(member);
      if (property === "innerWidth" || property === "innerHeight") continue;
      if (member !== registration.callee && member !== cleanup.callee) return false;
    }
  }
  return true;
};

export const isClosedEffectDeclarationSubscription = ({
  handler,
  effectCall,
  effectBodyStatements,
  subscriptionCall,
  stateDeclarator,
  initializer,
  setterArgument,
  scopes,
}: ClosedEffectDeclarationSubscription): boolean => {
  if (
    !isNodeOfType(handler, "FunctionDeclaration") ||
    !handler.id ||
    handler.async ||
    handler.generator ||
    handler.params.length !== 0 ||
    !isNodeOfType(effectCall, "CallExpression") ||
    !isNamedReactCall(effectCall, "useEffect", scopes) ||
    !isNodeOfType(stateDeclarator, "VariableDeclarator") ||
    !stateDeclarator.init ||
    !isNamedReactCall(stateDeclarator.init, "useState", scopes) ||
    !isNodeOfType(stateDeclarator.id, "ArrayPattern") ||
    !isNodeOfType(stateDeclarator.parent, "VariableDeclaration") ||
    stateDeclarator.parent.kind !== "const"
  ) {
    return false;
  }
  if (!isNodeOfType(stateDeclarator.init, "CallExpression")) return false;
  const [initialValue, ...extraInitialValues] = stateDeclarator.init.arguments;
  if (
    !initialValue ||
    isNodeOfType(initialValue, "SpreadElement") ||
    extraInitialValues.length !== 0
  )
    return false;
  const [state, setter, ...extraBindings] = stateDeclarator.id.elements;
  if (
    !isNodeOfType(state, "Identifier") ||
    !isNodeOfType(setter, "Identifier") ||
    extraBindings.length !== 0
  )
    return false;
  const [callback, dependencies, ...extraEffectArguments] = effectCall.arguments;
  if (
    (!isNodeOfType(callback, "ArrowFunctionExpression") &&
      !isNodeOfType(callback, "FunctionExpression")) ||
    callback.async ||
    callback.generator ||
    callback.params.length !== 0 ||
    !isNodeOfType(callback.body, "BlockStatement") ||
    !isNodeOfType(dependencies, "ArrayExpression") ||
    dependencies.elements.length !== 0 ||
    extraEffectArguments.length !== 0 ||
    handler.parent !== callback.body
  )
    return false;
  const [declaration, registration, cleanupReturn, ...extraStatements] = effectBodyStatements;
  if (
    declaration !== handler ||
    extraStatements.length !== 0 ||
    !isNodeOfType(registration, "ExpressionStatement") ||
    registration.expression !== subscriptionCall ||
    !isNodeOfType(cleanupReturn, "ReturnStatement") ||
    (!isNodeOfType(cleanupReturn.argument, "ArrowFunctionExpression") &&
      !isNodeOfType(cleanupReturn.argument, "FunctionExpression")) ||
    cleanupReturn.argument.async ||
    cleanupReturn.argument.generator ||
    cleanupReturn.argument.params.length !== 0 ||
    !isPlainWindowListener(subscriptionCall, "addEventListener", scopes)
  )
    return false;
  const [cleanupStatement, ...extraCleanupStatements] = getCallbackStatements(
    cleanupReturn.argument,
  );
  let cleanupCall: EsTreeNode | null | undefined = cleanupStatement;
  if (isNodeOfType(cleanupStatement, "ExpressionStatement")) {
    cleanupCall = cleanupStatement.expression;
  } else if (isNodeOfType(cleanupStatement, "ReturnStatement")) {
    cleanupCall = cleanupStatement.argument;
  }
  if (
    !cleanupCall ||
    extraCleanupStatements.length !== 0 ||
    !isPlainWindowListener(cleanupCall, "removeEventListener", scopes)
  )
    return false;
  if (
    !isNodeOfType(subscriptionCall, "CallExpression") ||
    !isNodeOfType(cleanupCall, "CallExpression")
  )
    return false;
  if (!hasClosedWindowReferences(scopes, subscriptionCall, cleanupCall)) return false;
  const [, registrationHandler] = subscriptionCall.arguments;
  const [, cleanupHandler] = cleanupCall.arguments;
  const handlerSymbol = isNodeOfType(registrationHandler, "Identifier")
    ? scopes.symbolFor(registrationHandler)
    : null;
  if (
    !handlerSymbol ||
    handlerSymbol.declarationNode !== handler ||
    !getFunctionBindingSymbols(handler, scopes).includes(handlerSymbol) ||
    !isNodeOfType(registrationHandler, "Identifier") ||
    !isNodeOfType(cleanupHandler, "Identifier") ||
    scopes.symbolFor(registrationHandler) !== handlerSymbol ||
    scopes.symbolFor(cleanupHandler) !== handlerSymbol ||
    !handlerSymbol.references.every(
      (reference) =>
        reference.flag === "read" &&
        (reference.identifier === registrationHandler || reference.identifier === cleanupHandler),
    )
  )
    return false;
  const [handlerStatement, ...extraHandlerStatements] = getCallbackStatements(handler);
  let setterCall: EsTreeNode | null | undefined = handlerStatement;
  if (isNodeOfType(handlerStatement, "ExpressionStatement")) {
    setterCall = handlerStatement.expression;
  } else if (isNodeOfType(handlerStatement, "ReturnStatement")) {
    setterCall = handlerStatement.argument;
  }
  if (
    !isNodeOfType(setterCall, "CallExpression") ||
    setterCall.optional ||
    extraHandlerStatements.length !== 0 ||
    !isNodeOfType(setterCall.callee, "Identifier")
  )
    return false;
  const setterSymbol = scopes.symbolFor(setter);
  const [payload, ...extraPayloads] = setterCall.arguments;
  if (
    !setterSymbol ||
    scopes.symbolFor(setterCall.callee) !== setterSymbol ||
    !hasOnlyReadonlySymbolReferences(setterSymbol) ||
    !payload ||
    extraPayloads.length !== 0 ||
    isNodeOfType(payload, "SpreadElement")
  )
    return false;
  let closed = true;
  walkAst(scopes.rootScope.node, (node) => {
    if (getGlobalRequireModuleSource(node, scopes) === "react") closed = false;
  });
  if (!closed) return false;
  const pendingScopes = [scopes.rootScope];
  while (pendingScopes.length > 0) {
    const scope = pendingScopes.pop();
    if (!scope) break;
    pendingScopes.push(...scope.children);
    if (
      scope.symbols.some(
        (symbol) =>
          getValueImportSource(symbol) === "react" &&
          (!isNodeOfType(symbol.declarationNode, "ImportSpecifier") ||
            getImportedName(symbol.declarationNode) === "default"),
      )
    )
      return false;
  }
  for (const expression of [initializer, setterArgument]) {
    walkAst(expression, (node) => {
      if (
        isNodeOfType(node, "ThisExpression") ||
        (isNodeOfType(node, "Identifier") && node.name === "arguments")
      ) {
        closed = false;
        return;
      }
      if (!isNodeOfType(node, "Identifier")) return;
      const reference = scopes.referenceFor(node);
      if (reference?.resolvedSymbol && !hasOnlyReadonlySymbolReferences(reference.resolvedSymbol))
        closed = false;
    });
  }
  return (
    closed &&
    areExpressionsStructurallyEqual(initializer, setterArgument, {
      areIdentifiersEqual: (first, second) => {
        if (!isNodeOfType(first, "Identifier") || !isNodeOfType(second, "Identifier")) return false;
        const firstSymbol = scopes.symbolFor(first);
        const secondSymbol = scopes.symbolFor(second);
        return firstSymbol || secondSymbol
          ? firstSymbol === secondSymbol
          : first.name === second.name &&
              scopes.isGlobalReference(first) &&
              scopes.isGlobalReference(second);
      },
    })
  );
};
