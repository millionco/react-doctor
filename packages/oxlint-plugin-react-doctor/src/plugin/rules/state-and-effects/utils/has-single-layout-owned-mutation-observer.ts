import type { SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { getFunctionBindingIdentifier } from "../../../utils/get-function-binding-name.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isDirectNamedReactHookCall } from "../../../utils/is-direct-named-react-hook-call.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isProvenUnmodifiedGlobalNamespaceReference } from "../../../utils/is-proven-unmodified-global-namespace-reference.js";
import { resolveReactRefSymbol } from "../../../utils/react-ref-origin.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { walkAst } from "../../../utils/walk-ast.js";

const readCallStatement = (statement: EsTreeNode | undefined): EsTreeNode | undefined =>
  isNodeOfType(statement, "ExpressionStatement") &&
  isNodeOfType(statement.expression, "CallExpression")
    ? statement.expression
    : undefined;

const readNullRef = (member: EsTreeNode, context: RuleContext): SymbolDescriptor | null => {
  if (!isNodeOfType(member, "MemberExpression") || member.computed || member.optional) return null;
  const receiver = member.object;
  const ref = resolveReactRefSymbol(member, context.scopes);
  if (!ref || context.scopes.symbolFor(receiver) !== ref || ref.kind !== "const") return null;
  const initializer = getDirectConstInitializer(ref);
  return isNodeOfType(initializer, "CallExpression") &&
    isDirectNamedReactHookCall(initializer, "useRef", context.scopes) &&
    initializer.arguments.length === 1 &&
    isNodeOfType(initializer.arguments[0], "Literal") &&
    initializer.arguments[0].value === null
    ? ref
    : null;
};

const readDisconnectAndReset = (
  statement: EsTreeNode | undefined,
  isCurrent: (expression: EsTreeNode) => boolean,
): boolean => {
  if (
    !isNodeOfType(statement, "IfStatement") ||
    statement.alternate ||
    !isCurrent(statement.test) ||
    !isNodeOfType(statement.consequent, "BlockStatement") ||
    statement.consequent.body.length !== 2
  ) {
    return false;
  }
  const [disconnectStatement, resetStatement] = statement.consequent.body;
  const disconnect = readCallStatement(disconnectStatement);
  const reset = isNodeOfType(resetStatement, "ExpressionStatement")
    ? resetStatement.expression
    : null;
  return (
    isNodeOfType(disconnect, "CallExpression") &&
    !disconnect.optional &&
    disconnect.arguments.length === 0 &&
    isNodeOfType(disconnect.callee, "MemberExpression") &&
    !disconnect.callee.optional &&
    !disconnect.callee.computed &&
    isNodeOfType(disconnect.callee.property, "Identifier") &&
    disconnect.callee.property.name === "disconnect" &&
    isCurrent(disconnect.callee.object) &&
    isNodeOfType(reset, "AssignmentExpression") &&
    reset.operator === "=" &&
    isCurrent(reset.left) &&
    isNodeOfType(reset.right, "Literal") &&
    reset.right.value === null
  );
};

const hasStaticChildListOptions = (options: EsTreeNode): boolean => {
  if (
    !isNodeOfType(options, "ObjectExpression") ||
    options.properties.length < 1 ||
    options.properties.length > 2
  ) {
    return false;
  }
  const optionNames = new Set<string>();
  for (const property of options.properties) {
    if (
      !isNodeOfType(property, "Property") ||
      property.kind !== "init" ||
      property.computed ||
      property.method ||
      !isNodeOfType(property.key, "Identifier") ||
      !["childList", "subtree"].includes(property.key.name) ||
      optionNames.has(property.key.name) ||
      !isNodeOfType(property.value, "Literal") ||
      typeof property.value.value !== "boolean" ||
      (property.key.name === "childList" && !property.value.value)
    ) {
      return false;
    }
    optionNames.add(property.key.name);
  }
  return optionNames.has("childList");
};

const INDIRECT_OBSERVER_GLOBALS = new Set([
  "Function",
  "Object",
  "Reflect",
  "document",
  "eval",
  "global",
  "globalThis",
  "require",
  "self",
  "window",
]);
const INDIRECT_OBSERVER_PROPERTIES = new Set([
  "MutationObserver",
  "__proto__",
  "constructor",
  "defaultView",
  "prototype",
]);

const OBSERVER_OWNER_HOOKS = new Set(["useCallback", "useLayoutEffect", "useRef"]);
const JSX_RUNTIME_DIRECTIVE = /@jsx(?:Runtime|ImportSource|Frag)?\b/u;

const hasClosedObserverConstructor = (constructor: EsTreeNode, context: RuleContext): boolean => {
  const { scopes } = context;
  const sourceText = context.getSourceText?.();
  if (
    sourceText === undefined ||
    JSX_RUNTIME_DIRECTIVE.test(sourceText) ||
    !isNodeOfType(constructor, "Identifier") ||
    !isProvenUnmodifiedGlobalNamespaceReference(
      constructor,
      "MutationObserver",
      scopes,
      undefined,
      true,
    )
  ) {
    return false;
  }
  let isClosed = true;
  walkAst(scopes.rootScope.node, (node) => {
    if (!isClosed) return false;
    if (
      isNodeOfType(node, "ThisExpression") ||
      isNodeOfType(node, "WithStatement") ||
      (isNodeOfType(node, "MemberExpression") &&
        INDIRECT_OBSERVER_PROPERTIES.has(getStaticPropertyName(node) ?? "")) ||
      isNodeOfType(node, "ImportExpression") ||
      isNodeOfType(node, "TSImportEqualsDeclaration") ||
      isNodeOfType(node, "ExportAllDeclaration") ||
      (isNodeOfType(node, "ExportNamedDeclaration") && node.source !== null) ||
      (isNodeOfType(node, "ImportDeclaration") &&
        node.importKind !== "type" &&
        (node.source.value !== "react" ||
          node.specifiers.length === 0 ||
          node.specifiers.some(
            (specifier) =>
              !isNodeOfType(specifier, "ImportSpecifier") ||
              !isNodeOfType(specifier.imported, "Identifier") ||
              (specifier.importKind !== "type" &&
                !OBSERVER_OWNER_HOOKS.has(specifier.imported.name)),
          ))) ||
      (isNodeOfType(node, "Identifier") &&
        node !== constructor &&
        scopes.referenceFor(node) &&
        scopes.isGlobalReference(node) &&
        (node.name === "MutationObserver" || INDIRECT_OBSERVER_GLOBALS.has(node.name)))
    ) {
      isClosed = false;
      return false;
    }
  });
  return isClosed;
};

export const hasSingleLayoutOwnedMutationObserver = (
  effectCall: EsTreeNode,
  retainedFunction: EsTreeNode,
  registration: EsTreeNode,
  context: RuleContext,
): boolean => {
  if (
    !isNodeOfType(effectCall, "CallExpression") ||
    !isDirectNamedReactHookCall(effectCall, "useLayoutEffect", context.scopes) ||
    effectCall.arguments.length !== 2 ||
    !isNodeOfType(effectCall.arguments[1], "ArrayExpression") ||
    !isNodeOfType(retainedFunction, "ArrowFunctionExpression") ||
    retainedFunction.async ||
    retainedFunction.params.length !== 0 ||
    !isNodeOfType(retainedFunction.body, "BlockStatement") ||
    retainedFunction.body.body.length !== 6 ||
    !isNodeOfType(registration, "CallExpression") ||
    registration.optional ||
    registration.arguments.length !== 2 ||
    !isNodeOfType(registration.callee, "MemberExpression") ||
    registration.callee.computed ||
    registration.callee.optional ||
    !isNodeOfType(registration.callee.property, "Identifier") ||
    registration.callee.property.name !== "observe" ||
    !hasStaticChildListOptions(registration.arguments[1])
  ) {
    return false;
  }
  const [effect, dependencies] = effectCall.arguments;
  if (
    !isNodeOfType(effect, "ArrowFunctionExpression") ||
    effect.async ||
    effect.params.length !== 0 ||
    !isNodeOfType(effect.body, "BlockStatement") ||
    effect.body.body.length !== 2
  ) {
    return false;
  }
  const [invoke, cleanupReturn] = effect.body.body;
  const setup = readCallStatement(invoke);
  const cleanup = isNodeOfType(cleanupReturn, "ReturnStatement") ? cleanupReturn.argument : null;
  if (
    !isNodeOfType(setup, "CallExpression") ||
    setup.optional ||
    setup.arguments.length !== 0 ||
    !isNodeOfType(setup.callee, "Identifier") ||
    !isNodeOfType(cleanup, "ArrowFunctionExpression") ||
    cleanup.async ||
    cleanup.params.length !== 0 ||
    !isNodeOfType(cleanup.body, "BlockStatement") ||
    cleanup.body.body.length !== 1
  ) {
    return false;
  }

  const bindingsRoot = context.scopes.rootScope.node;
  const binding = getFunctionBindingIdentifier(retainedFunction);
  const start = binding ? context.scopes.symbolFor(binding) : null;
  const startInitializer = start && getDirectConstInitializer(start);
  const component = findEnclosingFunction(retainedFunction);
  if (
    !component ||
    component !== findEnclosingFunction(effect) ||
    !start ||
    context.scopes.symbolFor(setup.callee) !== start ||
    !isNodeOfType(startInitializer, "CallExpression") ||
    startInitializer.arguments[0] !== retainedFunction ||
    !isNodeOfType(startInitializer.arguments[1], "ArrayExpression") ||
    !isDirectNamedReactHookCall(startInitializer, "useCallback", context.scopes) ||
    !hasCompleteSymbolReferences(start, bindingsRoot, context.scopes) ||
    !start.references.every(
      ({ identifier }) =>
        identifier === setup.callee ||
        dependencies.elements.some((element) => element === identifier),
    )
  ) {
    return false;
  }

  const [
    targetStatement,
    targetGuard,
    previousRelease,
    observerStatement,
    observe,
    storeStatement,
  ] = retainedFunction.body.body;
  const target =
    isNodeOfType(targetStatement, "VariableDeclaration") &&
    targetStatement.kind === "const" &&
    targetStatement.declarations.length === 1
      ? targetStatement.declarations[0]
      : null;
  const observer =
    isNodeOfType(observerStatement, "VariableDeclaration") &&
    observerStatement.kind === "const" &&
    observerStatement.declarations.length === 1
      ? observerStatement.declarations[0]
      : null;
  const store = isNodeOfType(storeStatement, "ExpressionStatement")
    ? storeStatement.expression
    : null;
  if (
    !target?.init ||
    !isNodeOfType(target.id, "Identifier") ||
    !isNodeOfType(targetGuard, "IfStatement") ||
    targetGuard.alternate ||
    !isNodeOfType(targetGuard.test, "UnaryExpression") ||
    targetGuard.test.operator !== "!" ||
    !isNodeOfType(targetGuard.consequent, "ReturnStatement") ||
    targetGuard.consequent.argument ||
    !isNodeOfType(observer?.init, "NewExpression") ||
    !isNodeOfType(observer.id, "Identifier") ||
    !hasClosedObserverConstructor(observer.init.callee, context) ||
    observer.init.arguments.length !== 1 ||
    !isNodeOfType(observer.init.arguments[0], "ArrowFunctionExpression") ||
    observer.init.arguments[0].params.length !== 0 ||
    readCallStatement(observe) !== registration ||
    !isNodeOfType(registration.callee.object, "Identifier") ||
    !isNodeOfType(registration.arguments[0], "Identifier") ||
    !isNodeOfType(store, "AssignmentExpression") ||
    store.operator !== "=" ||
    !isNodeOfType(store.right, "Identifier")
  ) {
    return false;
  }
  const guardedTarget = targetGuard.test.argument;
  const observedTarget = registration.arguments[0];
  const observerReceiver = registration.callee.object;
  const storedObserver = store.right;
  const targetBinding = context.scopes.symbolFor(target.id);
  const observerBinding = context.scopes.symbolFor(observer.id);
  if (
    !targetBinding ||
    context.scopes.symbolFor(guardedTarget) !== targetBinding ||
    context.scopes.symbolFor(observedTarget) !== targetBinding ||
    !hasCompleteSymbolReferences(targetBinding, bindingsRoot, context.scopes) ||
    !targetBinding.references.every(
      ({ identifier }) => identifier === guardedTarget || identifier === observedTarget,
    ) ||
    !observerBinding ||
    context.scopes.symbolFor(observerReceiver) !== observerBinding ||
    context.scopes.symbolFor(storedObserver) !== observerBinding ||
    !hasCompleteSymbolReferences(observerBinding, bindingsRoot, context.scopes) ||
    !observerBinding.references.every(
      ({ identifier }) => identifier === observerReceiver || identifier === storedObserver,
    )
  ) {
    return false;
  }

  const holder = readNullRef(store.left, context);
  const host = readNullRef(target.init, context);
  if (!holder || !host || holder === host) return false;
  if (
    findEnclosingFunction(holder.declarationNode) !== component ||
    findEnclosingFunction(host.declarationNode) !== component ||
    !hasCompleteSymbolReferences(holder, bindingsRoot, context.scopes) ||
    !hasCompleteSymbolReferences(host, bindingsRoot, context.scopes) ||
    host.references.length !== 2 ||
    !isNodeOfType(target.init, "MemberExpression")
  ) {
    return false;
  }
  const hostReceiver = target.init.object;
  const hasIntrinsicHostRef = host.references.some(({ identifier }) => {
    const expression = identifier.parent;
    const attribute = expression?.parent;
    const opening = attribute?.parent;
    return (
      isNodeOfType(expression, "JSXExpressionContainer") &&
      isNodeOfType(attribute, "JSXAttribute") &&
      isNodeOfType(attribute.name, "JSXIdentifier") &&
      attribute.name.name === "ref" &&
      isNodeOfType(opening, "JSXOpeningElement") &&
      isNodeOfType(opening.name, "JSXIdentifier") &&
      opening.name.name === "div" &&
      opening.attributes.length === 1
    );
  });
  if (
    !hasIntrinsicHostRef ||
    !host.references.some(({ identifier }) => identifier === hostReceiver)
  ) {
    return false;
  }
  const holderReferences = new Set<EsTreeNode>();
  const isOwnedCurrent = (node: EsTreeNode): boolean => {
    if (!isNodeOfType(node, "MemberExpression") || readNullRef(node, context) !== holder)
      return false;
    holderReferences.add(node.object);
    return true;
  };
  return (
    isOwnedCurrent(store.left) &&
    readDisconnectAndReset(previousRelease, isOwnedCurrent) &&
    readDisconnectAndReset(cleanup.body.body[0], isOwnedCurrent) &&
    holder.references.every(({ identifier }) => holderReferences.has(identifier))
  );
};
