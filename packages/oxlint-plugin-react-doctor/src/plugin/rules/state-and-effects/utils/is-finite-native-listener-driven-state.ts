import { EFFECT_HOOK_NAMES } from "../../../constants/react.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { hasRuntimeValueBinding } from "../../../utils/has-runtime-value-binding.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getAssignedExpressionForWrite } from "../../../utils/get-assigned-expression-for-write.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { getStaticStringExpression } from "../../../utils/get-static-string-expression.js";
import { isAstNode } from "../../../utils/is-ast-node.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isProvenUnmodifiedGlobalNamespaceReference } from "../../../utils/is-proven-unmodified-global-namespace-reference.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { resolveImportedApiReference } from "../../../utils/resolve-imported-api-reference.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";

interface NativeListenerCall {
  call: EsTreeNodeOfType<"CallExpression">;
  member: EsTreeNodeOfType<"MemberExpression">;
  eventName: string;
  handler: EsTreeNodeOfType<"Identifier">;
  namespaceName: string;
}

interface NativeStateHandler {
  functionNode: EsTreeNode;
  parameter: SymbolDescriptor;
  hasOnlyMouseMoveEvents: boolean;
}

interface NativeStateCertificates {
  runtimeScopes: ScopeAnalysis;
  providerAccepted: boolean | null;
  selectors: WeakMap<SymbolDescriptor, boolean>;
  handlers: WeakMap<SymbolDescriptor, NativeStateHandler | null>;
  imports: WeakMap<SymbolDescriptor, boolean>;
  states: WeakMap<SymbolDescriptor, boolean>;
}

const NATIVE_STATE_CERTIFICATES = new WeakMap<ScopeAnalysis, NativeStateCertificates>();
const NATIVE_LISTENER_METHOD_NAMES = new Set(["addEventListener", "removeEventListener"]);
const NATIVE_COORDINATE_PROPERTY_NAMES = new Set(["clientX", "clientY"]);
const NATIVE_PROVIDER_EXECUTION_NAMES = new Set([
  "eval",
  "Function",
  "Object",
  "Reflect",
  "require",
  "getBuiltinModule",
]);
const NATIVE_PROVIDER_MEMBER_NAMES = new Set([
  ...NATIVE_PROVIDER_EXECUTION_NAMES,
  "document",
  "window",
  "self",
  "globalThis",
  "global",
  "constructor",
  "prototype",
  "__proto__",
  "__defineGetter__",
  "__defineSetter__",
  "dispatchEvent",
]);
const NATIVE_PROVIDER_MODULE_NAMES = new Set(["vm", "node:vm", "module", "node:module"]);
const RUNTIME_TYPESCRIPT_PROVIDER_NODE_TYPES = new Set([
  "TSModuleDeclaration",
  "TSModuleBlock",
  "TSEnumDeclaration",
  "TSImportEqualsDeclaration",
  "TSExportAssignment",
  "TSParameterProperty",
  "Decorator",
]);
const NATIVE_STATE_REACT_API_NAMES = new Set(["useState", "useRef", ...EFFECT_HOOK_NAMES]);
const NATIVE_STATE_HOOK_NAMES = new Set(["useState"]);

const getNativeStateCertificates = (scopes: ScopeAnalysis): NativeStateCertificates => {
  let certificates = NATIVE_STATE_CERTIFICATES.get(scopes);
  if (!certificates) {
    certificates = {
      runtimeScopes: {
        ...scopes,
        isGlobalReference: (identifier) => {
          if (scopes.isGlobalReference(identifier)) return true;
          const symbol = scopes.symbolFor(identifier);
          return Boolean(
            symbol &&
            (symbol.kind === "ts-interface" || symbol.kind === "ts-type-alias") &&
            !hasRuntimeValueBinding(symbol),
          );
        },
      },
      providerAccepted: null,
      selectors: new WeakMap(),
      handlers: new WeakMap(),
      imports: new WeakMap(),
      states: new WeakMap(),
    };
    NATIVE_STATE_CERTIFICATES.set(scopes, certificates);
  }
  return certificates;
};

const getNativeListenerCall = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
): NativeListenerCall | null => {
  if (!isNodeOfType(expression, "CallExpression") || expression.optional) return null;
  const member = stripParenExpression(expression.callee);
  if (!isNodeOfType(member, "MemberExpression") || member.optional) return null;
  const receiver = stripParenExpression(member.object);
  if (
    !isNodeOfType(receiver, "Identifier") ||
    (receiver.name !== "document" && receiver.name !== "window") ||
    !scopes.isGlobalReference(receiver)
  )
    return null;
  const [event, handler, capture, ...unsupportedArguments] = expression.arguments;
  if (!event || !handler || unsupportedArguments.length) return null;
  const eventName = getStaticStringExpression(event);
  if (!eventName || !isNodeOfType(handler, "Identifier")) return null;
  if (capture && (!isNodeOfType(capture, "Literal") || typeof capture.value !== "boolean"))
    return null;
  return { call: expression, member, eventName, handler, namespaceName: receiver.name };
};

const isFiniteNativeSelector = (
  symbol: SymbolDescriptor,
  context: RuleContext,
  certificates: NativeStateCertificates,
): boolean => {
  const cached = certificates.selectors.get(symbol);
  if (cached !== undefined) return cached;
  certificates.selectors.set(symbol, false);
  const declaration = symbol.declarationNode;
  if (
    symbol.kind !== "let" ||
    !isNodeOfType(declaration, "VariableDeclarator") ||
    declaration.id !== symbol.bindingIdentifier ||
    getStaticStringExpression(declaration.init) !== "addEventListener"
  )
    return false;
  const statement = declaration.parent;
  const helper = findEnclosingFunction(declaration);
  if (
    !isNodeOfType(statement, "VariableDeclaration") ||
    statement.kind !== "let" ||
    !isFunctionLike(helper) ||
    helper.async ||
    helper.generator ||
    !isNodeOfType(helper.body, "BlockStatement")
  )
    return false;
  const [onlyDeclaration, ...otherDeclarations] = statement.declarations;
  const [parameter, ...otherParameters] = helper.params;
  const [firstStatement, condition, ...listenerStatements] = helper.body.body;
  if (
    onlyDeclaration !== declaration ||
    otherDeclarations.length ||
    !isNodeOfType(parameter, "Identifier") ||
    otherParameters.length ||
    firstStatement !== statement ||
    !isNodeOfType(condition, "IfStatement") ||
    condition.alternate ||
    !listenerStatements.length
  )
    return false;
  const parameterSymbol = context.scopes.symbolFor(parameter);
  const test = stripParenExpression(condition.test);
  if (
    !parameterSymbol ||
    !isNodeOfType(test, "Identifier") ||
    context.scopes.symbolFor(test) !== parameterSymbol
  )
    return false;
  let assignmentStatement = condition.consequent;
  if (isNodeOfType(assignmentStatement, "BlockStatement")) {
    const [onlyStatement, ...otherStatements] = assignmentStatement.body;
    if (!onlyStatement || otherStatements.length) return false;
    assignmentStatement = onlyStatement;
  }
  if (!isNodeOfType(assignmentStatement, "ExpressionStatement")) return false;
  const assignment = stripParenExpression(assignmentStatement.expression);
  if (!isNodeOfType(assignment, "AssignmentExpression") || assignment.operator !== "=")
    return false;
  const assignmentTarget = stripParenExpression(assignment.left);
  if (
    !isNodeOfType(assignmentTarget, "Identifier") ||
    context.scopes.symbolFor(assignmentTarget) !== symbol ||
    getStaticStringExpression(getAssignedExpressionForWrite(assignmentTarget)) !==
      "removeEventListener"
  )
    return false;
  const listenerCalls = new Set<EsTreeNode>();
  for (const listenerStatement of listenerStatements) {
    if (!isNodeOfType(listenerStatement, "ExpressionStatement")) return false;
    const listener = getNativeListenerCall(
      stripParenExpression(listenerStatement.expression),
      certificates.runtimeScopes,
    );
    if (
      !listener ||
      !listener.member.computed ||
      !isNodeOfType(listener.member.property, "Identifier") ||
      context.scopes.symbolFor(listener.member.property) !== symbol
    )
      return false;
    listenerCalls.add(listener.call);
  }
  if (
    !parameterSymbol.references.every(
      (reference) => reference.flag === "read" && reference.identifier === test,
    )
  )
    return false;
  for (const reference of symbol.references) {
    if (reference.identifier === symbol.bindingIdentifier) continue;
    if (reference.flag === "write" && reference.identifier === assignmentTarget) continue;
    if (reference.flag !== "read") return false;
    const identifier = findTransparentExpressionRoot(reference.identifier);
    const member = identifier.parent;
    if (
      !isNodeOfType(member, "MemberExpression") ||
      !member.computed ||
      member.property !== identifier
    )
      return false;
    const call = findTransparentExpressionRoot(member).parent;
    if (!call || !listenerCalls.has(call)) return false;
  }
  certificates.selectors.set(symbol, true);
  return true;
};

const isReadonlyReactImport = (
  symbol: SymbolDescriptor,
  context: RuleContext,
  certificates: NativeStateCertificates,
): boolean => {
  const cached = certificates.imports.get(symbol);
  if (cached !== undefined) return cached;
  certificates.imports.set(symbol, false);
  if (symbol.kind !== "import") return false;
  for (const reference of symbol.references) {
    if (isTypeScriptTypePosition(reference.identifier)) continue;
    if (reference.flag !== "read" || isWithinAssignmentTarget(reference.identifier)) return false;
    const identifier = findTransparentExpressionRoot(reference.identifier);
    const member = identifier.parent;
    const apiExpression =
      isNodeOfType(member, "MemberExpression") && member.object === identifier
        ? member
        : identifier;
    const call = findTransparentExpressionRoot(apiExpression).parent;
    if (
      !isNodeOfType(call, "CallExpression") ||
      call.optional ||
      call.callee !== findTransparentExpressionRoot(apiExpression)
    )
      return false;
    const imported = resolveImportedApiReference(apiExpression, context.scopes);
    if (
      imported?.source !== "react" ||
      !imported.importedName ||
      !NATIVE_STATE_REACT_API_NAMES.has(imported.importedName)
    )
      return false;
  }
  certificates.imports.set(symbol, true);
  return true;
};

const isRuntimeReactApiCall = (
  call: EsTreeNode,
  apiNames: ReadonlySet<string>,
  context: RuleContext,
  certificates: NativeStateCertificates,
): boolean => {
  if (!isNodeOfType(call, "CallExpression") || call.optional) return false;
  const callee = stripParenExpression(call.callee);
  const receiver = isNodeOfType(callee, "MemberExpression")
    ? stripParenExpression(callee.object)
    : callee;
  if (!isNodeOfType(receiver, "Identifier")) return false;
  const symbol = context.scopes.symbolFor(receiver);
  if (symbol?.kind !== "import") return false;
  const imported = resolveImportedApiReference(callee, context.scopes);
  return Boolean(
    imported?.source === "react" &&
    imported.importedName &&
    apiNames.has(imported.importedName) &&
    symbol &&
    isReadonlyReactImport(symbol, context, certificates),
  );
};

const hasFiniteNativeProviders = (
  context: RuleContext,
  certificates: NativeStateCertificates,
): boolean => {
  if (certificates.providerAccepted !== null) return certificates.providerAccepted;
  let accepted = true;
  walkAst(context.scopes.rootScope.node, (node) => {
    if (!accepted) return false;
    if (
      RUNTIME_TYPESCRIPT_PROVIDER_NODE_TYPES.has(node.type) ||
      isNodeOfType(node, "WithStatement") ||
      isNodeOfType(node, "ImportExpression")
    ) {
      accepted = false;
      return false;
    }
    if (isTypeScriptTypePosition(node)) return false;
    if (
      isNodeOfType(node, "ImportDeclaration") &&
      NATIVE_PROVIDER_MODULE_NAMES.has(getStaticStringExpression(node.source) ?? "")
    ) {
      if (
        node.importKind !== "type" &&
        (!node.specifiers.length ||
          node.specifiers.some(
            (specifier) =>
              !isNodeOfType(specifier, "ImportSpecifier") || specifier.importKind !== "type",
          ))
      )
        accepted = false;
    }
    if (isNodeOfType(node, "Identifier") && certificates.runtimeScopes.isGlobalReference(node)) {
      if (NATIVE_PROVIDER_EXECUTION_NAMES.has(node.name)) accepted = false;
      if (node.name === "document" || node.name === "window") {
        const expression = findTransparentExpressionRoot(node);
        if (
          !isNodeOfType(expression.parent, "MemberExpression") ||
          expression.parent.object !== expression
        )
          accepted = false;
      }
    }
    if (isNodeOfType(node, "MemberExpression")) {
      const propertyName = getStaticPropertyName(node);
      if (propertyName && NATIVE_PROVIDER_MEMBER_NAMES.has(propertyName)) accepted = false;
      if (node.computed && propertyName === null) {
        const call = findTransparentExpressionRoot(node).parent;
        const listener = call ? getNativeListenerCall(call, certificates.runtimeScopes) : null;
        const selector = isNodeOfType(node.property, "Identifier")
          ? context.scopes.symbolFor(node.property)
          : null;
        if (
          !listener ||
          listener.member !== node ||
          !selector ||
          !isFiniteNativeSelector(selector, context, certificates)
        )
          accepted = false;
      }
      if (propertyName && NATIVE_LISTENER_METHOD_NAMES.has(propertyName)) {
        if (isWithinAssignmentTarget(node)) accepted = false;
        const receiver = stripParenExpression(node.object);
        if (
          isNodeOfType(receiver, "Identifier") &&
          (receiver.name === "document" || receiver.name === "window") &&
          certificates.runtimeScopes.isGlobalReference(receiver)
        ) {
          const call = findTransparentExpressionRoot(node).parent;
          if (
            !isNodeOfType(call, "CallExpression") ||
            call.callee !== findTransparentExpressionRoot(node)
          )
            accepted = false;
        }
      }
    }
    if (isNodeOfType(node, "Property") && isNodeOfType(node.parent, "ObjectPattern")) {
      const propertyName = getStaticPropertyKeyName(node, { allowComputedString: true });
      if (!propertyName || NATIVE_PROVIDER_MEMBER_NAMES.has(propertyName)) accepted = false;
    }
    return accepted;
  });
  certificates.providerAccepted = accepted;
  return accepted;
};

const getNativeStateHandler = (
  symbol: SymbolDescriptor,
  context: RuleContext,
  certificates: NativeStateCertificates,
): NativeStateHandler | null => {
  if (certificates.handlers.has(symbol)) return certificates.handlers.get(symbol) ?? null;
  certificates.handlers.set(symbol, null);
  const declaration = symbol.declarationNode;
  if (
    symbol.kind !== "const" ||
    !isNodeOfType(declaration, "VariableDeclarator") ||
    declaration.id !== symbol.bindingIdentifier
  )
    return null;
  const functionNode = declaration.init ? stripParenExpression(declaration.init) : null;
  if (!isNodeOfType(functionNode, "ArrowFunctionExpression") || functionNode.async) return null;
  const [parameter, ...otherParameters] = functionNode.params;
  if (!isNodeOfType(parameter, "Identifier") || otherParameters.length) return null;
  const parameterSymbol = context.scopes.symbolFor(parameter);
  if (!parameterSymbol) return null;
  for (const reference of parameterSymbol.references) {
    if (isTypeScriptTypePosition(reference.identifier)) continue;
    const expression = findTransparentExpressionRoot(reference.identifier);
    const member = expression.parent;
    if (
      reference.flag !== "read" ||
      !isNodeOfType(member, "MemberExpression") ||
      member.object !== expression ||
      member.computed ||
      member.optional ||
      !NATIVE_COORDINATE_PROPERTY_NAMES.has(getStaticPropertyName(member) ?? "") ||
      isWithinAssignmentTarget(member)
    )
      return null;
    const field = findTransparentExpressionRoot(member);
    if (
      (isNodeOfType(field.parent, "MemberExpression") && field.parent.object === field) ||
      (isNodeOfType(field.parent, "CallExpression") && field.parent.callee === field)
    )
      return null;
  }
  let hasRegistration = false;
  let hasOnlyMouseMoveEvents = true;
  if (!symbol.references.length) return null;
  for (const reference of symbol.references) {
    if (reference.flag !== "read") return null;
    const handler = findTransparentExpressionRoot(reference.identifier);
    const listener = handler.parent
      ? getNativeListenerCall(handler.parent, certificates.runtimeScopes)
      : null;
    if (!listener || listener.handler !== handler) return null;
    let methodName = getStaticPropertyName(listener.member);
    if (listener.member.computed && methodName === null) {
      const selector = isNodeOfType(listener.member.property, "Identifier")
        ? context.scopes.symbolFor(listener.member.property)
        : null;
      if (!selector || !isFiniteNativeSelector(selector, context, certificates)) return null;
      methodName = "addEventListener";
    }
    if (!methodName || !NATIVE_LISTENER_METHOD_NAMES.has(methodName)) return null;
    for (const nativeMethod of NATIVE_LISTENER_METHOD_NAMES) {
      if (
        !isProvenUnmodifiedGlobalNamespaceReference(
          listener.member.object,
          listener.namespaceName,
          certificates.runtimeScopes,
          nativeMethod,
        )
      )
        return null;
    }
    hasRegistration ||= methodName === "addEventListener";
    hasOnlyMouseMoveEvents &&= listener.eventName === "mousemove";
  }
  if (!hasRegistration) return null;
  const result = { functionNode, parameter: parameterSymbol, hasOnlyMouseMoveEvents };
  certificates.handlers.set(symbol, result);
  return result;
};

const getPrimitiveSnapshotFields = (
  expression: EsTreeNode,
  handler: NativeStateHandler | null,
  context: RuleContext,
): Set<string> | null => {
  const snapshot = stripParenExpression(expression);
  if (!isNodeOfType(snapshot, "ObjectExpression") || !snapshot.properties.length) return null;
  const fields = new Set<string>();
  for (const property of snapshot.properties) {
    if (
      !isNodeOfType(property, "Property") ||
      property.computed ||
      property.method ||
      property.kind !== "init"
    )
      return null;
    const fieldName = getStaticPropertyKeyName(property);
    if (!fieldName || fields.has(fieldName) || NATIVE_PROVIDER_MEMBER_NAMES.has(fieldName))
      return null;
    const value = stripParenExpression(property.value);
    const isPrimitiveLiteral =
      isNodeOfType(value, "Literal") &&
      (value.value === null ||
        typeof value.value === "string" ||
        typeof value.value === "number" ||
        typeof value.value === "boolean");
    if (!isPrimitiveLiteral) {
      if (
        !handler?.hasOnlyMouseMoveEvents ||
        !isNodeOfType(value, "MemberExpression") ||
        value.computed ||
        value.optional
      )
        return null;
      const receiver = stripParenExpression(value.object);
      const propertyName = getStaticPropertyName(value);
      if (
        !isNodeOfType(receiver, "Identifier") ||
        context.scopes.symbolFor(receiver) !== handler.parameter ||
        !propertyName ||
        !NATIVE_COORDINATE_PROPERTY_NAMES.has(propertyName)
      )
        return null;
    }
    fields.add(fieldName);
  }
  return fields;
};

const isReadonlyObjectStateReference = (
  identifier: EsTreeNode,
  fields: ReadonlySet<string>,
  context: RuleContext,
  certificates: NativeStateCertificates,
): boolean => {
  const expression = findTransparentExpressionRoot(identifier);
  const consumer = expression.parent;
  if (isNodeOfType(consumer, "ArrayExpression")) {
    const effect = consumer.parent;
    if (!isNodeOfType(effect, "CallExpression")) return false;
    const [, dependencies] = effect.arguments;
    return (
      dependencies === consumer &&
      isRuntimeReactApiCall(effect, EFFECT_HOOK_NAMES, context, certificates)
    );
  }
  if (
    !isNodeOfType(consumer, "MemberExpression") ||
    consumer.object !== expression ||
    consumer.computed ||
    consumer.optional
  )
    return false;
  const fieldName = getStaticPropertyName(consumer);
  if (!fieldName || !fields.has(fieldName) || isWithinAssignmentTarget(consumer)) return false;
  const field = findTransparentExpressionRoot(consumer);
  return (
    !(isNodeOfType(field.parent, "MemberExpression") && field.parent.object === field) &&
    !(isNodeOfType(field.parent, "CallExpression") && field.parent.callee === field)
  );
};

const computeFiniteNativeListenerDrivenState = (
  symbol: SymbolDescriptor,
  context: RuleContext,
  certificates: NativeStateCertificates,
): boolean => {
  const declaration = symbol.declarationNode;
  if (
    symbol.kind !== "const" ||
    !isNodeOfType(declaration, "VariableDeclarator") ||
    !isNodeOfType(declaration.id, "ArrayPattern") ||
    !declaration.init
  )
    return false;
  const [stateBinding, setterBinding, ...otherBindings] = declaration.id.elements;
  if (
    stateBinding !== symbol.bindingIdentifier ||
    !isNodeOfType(setterBinding, "Identifier") ||
    otherBindings.length
  )
    return false;
  const initializer = stripParenExpression(declaration.init);
  if (
    !isNodeOfType(initializer, "CallExpression") ||
    !isRuntimeReactApiCall(initializer, NATIVE_STATE_HOOK_NAMES, context, certificates)
  )
    return false;
  const [initialSnapshot, ...otherArguments] = initializer.arguments;
  if (!initialSnapshot || otherArguments.length) return false;
  const fields = getPrimitiveSnapshotFields(initialSnapshot, null, context);
  const setter = context.scopes.symbolFor(setterBinding);
  if (!fields || !setter || !setter.references.length) return false;
  let selectedHandler: NativeStateHandler | null = null;
  for (const reference of setter.references) {
    if (reference.flag !== "read") return false;
    const callee = findTransparentExpressionRoot(reference.identifier);
    const call = callee.parent;
    if (!isNodeOfType(call, "CallExpression") || call.optional || call.callee !== callee)
      return false;
    const functionNode = findEnclosingFunction(call);
    if (!isFunctionLike(functionNode)) return false;
    const handlerDeclaration = functionNode.parent;
    if (
      !isNodeOfType(handlerDeclaration, "VariableDeclarator") ||
      !isNodeOfType(handlerDeclaration.id, "Identifier")
    )
      return false;
    const handlerSymbol = context.scopes.symbolFor(handlerDeclaration.id);
    const handler = handlerSymbol
      ? getNativeStateHandler(handlerSymbol, context, certificates)
      : null;
    if (
      !handler ||
      handler.functionNode !== functionNode ||
      findEnclosingFunction(functionNode) !== findEnclosingFunction(declaration)
    )
      return false;
    if (selectedHandler && selectedHandler !== handler) return false;
    selectedHandler = handler;
    const [snapshot, ...otherSetterArguments] = call.arguments;
    if (!snapshot || otherSetterArguments.length) return false;
    const writtenFields = getPrimitiveSnapshotFields(snapshot, handler, context);
    if (
      !writtenFields ||
      writtenFields.size !== fields.size ||
      [...fields].some((field) => !writtenFields.has(field))
    )
      return false;
  }
  if (!selectedHandler) return false;
  for (const reference of symbol.references) {
    if (isTypeScriptTypePosition(reference.identifier)) continue;
    if (
      reference.flag !== "read" ||
      !isReadonlyObjectStateReference(reference.identifier, fields, context, certificates)
    )
      return false;
  }
  return true;
};

export const isFiniteNativeListenerDrivenState = (
  dependencyIdentifier: unknown,
  context: RuleContext,
): boolean => {
  if (!isAstNode(dependencyIdentifier) || !isNodeOfType(dependencyIdentifier, "Identifier"))
    return false;
  const symbol = context.scopes.symbolFor(dependencyIdentifier);
  if (!symbol) return false;
  const certificates = getNativeStateCertificates(context.scopes);
  const cached = certificates.states.get(symbol);
  if (cached !== undefined) return cached;
  const result =
    hasFiniteNativeProviders(context, certificates) &&
    computeFiniteNativeListenerDrivenState(symbol, context, certificates);
  certificates.states.set(symbol, result);
  return result;
};
