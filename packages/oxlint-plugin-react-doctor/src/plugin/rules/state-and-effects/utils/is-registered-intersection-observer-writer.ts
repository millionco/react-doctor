import { EFFECT_HOOK_NAMES } from "../../../constants/react.js";
import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getCallbackStatements } from "../../../utils/get-callback-statements.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { getResolvedStaticPropertyName } from "../../../utils/get-resolved-static-property-name.js";
import { getSymbolTypeAnnotation } from "../../../utils/get-symbol-type-annotation.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { hasEnclosingTypeParameterNamed } from "../../../utils/has-enclosing-type-parameter-named.js";
import { hasPossibleStaticPropertyMutationOrEscapeBefore } from "../../../utils/has-static-property-write-before.js";
import { hasVisibleBindingNamed } from "../../../utils/has-visible-binding-named.js";
import { isAstDescendant } from "../../../utils/is-ast-descendant.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isNodeReachableWithinFunction } from "../../../utils/is-node-reachable-within-function.js";
import { isProvenGlobalNamespaceReference } from "../../../utils/is-proven-global-namespace-reference.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { isReactApiCall } from "../../../utils/is-react-api-call.js";
import { resolveConstIdentifierAlias } from "../../../utils/resolve-const-identifier-alias.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";

const BROWSER_GLOBAL_NAMES = new Set(["globalThis", "global", "self", "window"]);
const REALM_OR_PROTOTYPE_ACCESS_NAMES = new Set([
  "__proto__",
  "constructor",
  "prototype",
  "getPrototypeOf",
  "contentWindow",
  "defaultView",
  "eval",
]);
const hasClosedObserverProvidersCache = new WeakMap<ScopeAnalysis, boolean>();

const isNativeArrayIsArrayCall = (call: EsTreeNode | null | undefined, scopes: ScopeAnalysis) => {
  if (!isNodeOfType(call, "CallExpression") || call.optional) return false;
  const callee = call.callee;
  return (
    isNodeOfType(callee, "MemberExpression") &&
    !callee.optional &&
    getStaticPropertyName(callee) === "isArray" &&
    isNodeOfType(callee.object, "Identifier") &&
    callee.object.name === "Array" &&
    scopes.isGlobalReference(callee.object)
  );
};

const isConstructorCallee = (node: EsTreeNode): boolean => {
  const root = findTransparentExpressionRoot(node);
  return isNodeOfType(root.parent, "NewExpression") && root.parent.callee === root;
};

// Limit this proof to files that use the native providers without exposing
// their global objects or prototypes. An alias, store, or unknown call can
// otherwise replace the constructor or intercept delivery via forEach.
const hasClosedObserverProviders = (scopes: ScopeAnalysis): boolean => {
  const cached = hasClosedObserverProvidersCache.get(scopes);
  if (cached !== undefined) return cached;
  let closed = true;
  walkAst(scopes.rootScope.node, (node) => {
    if (!closed) return false;
    if (isNodeOfType(node, "MemberExpression")) {
      const key = getResolvedStaticPropertyName(node, scopes, { stringifyNonStringLiterals: true });
      closed = key !== null && !REALM_OR_PROTOTYPE_ACCESS_NAMES.has(key);
      return;
    }
    if (isNodeOfType(node, "Property") && isNodeOfType(node.parent, "ObjectPattern")) {
      const key = getStaticPropertyKeyName(node, { allowComputedString: true });
      closed = key !== null && !REALM_OR_PROTOTYPE_ACCESS_NAMES.has(key);
      return;
    }
    if (isNodeOfType(node, "ThisExpression") || isNodeOfType(node, "WithStatement")) {
      closed = false;
      return;
    }
    if (!isNodeOfType(node, "Identifier") || !scopes.isGlobalReference(node)) return;
    const root = findTransparentExpressionRoot(node);
    const consumer = root.parent;
    if (node.name === "eval" || node.name === "Function") {
      closed = false;
    } else if (node.name === "Array") {
      closed =
        isNodeOfType(consumer, "MemberExpression") &&
        consumer.object === root &&
        isNativeArrayIsArrayCall(consumer.parent, scopes);
    } else if (node.name === "IntersectionObserver") {
      closed = isConstructorCallee(root);
    } else if (BROWSER_GLOBAL_NAMES.has(node.name)) {
      closed =
        (isNodeOfType(consumer, "BinaryExpression") &&
          consumer.operator === "in" &&
          consumer.right === root &&
          isNodeOfType(consumer.left, "Literal") &&
          consumer.left.value === "IntersectionObserver") ||
        (isNodeOfType(consumer, "MemberExpression") &&
          consumer.object === root &&
          getStaticPropertyName(consumer) === "IntersectionObserver" &&
          isConstructorCallee(consumer));
    }
  });
  hasClosedObserverProvidersCache.set(scopes, closed);
  return closed;
};

const carriesEventValue = (
  argument: EsTreeNode | undefined,
  binding: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (!argument) return false;
  const eventSymbol = scopes.symbolFor(binding);
  if (!eventSymbol || eventSymbol.references.some((reference) => reference.flag !== "read")) {
    return false;
  }
  const readsEvent = (expression: EsTreeNode): boolean => {
    const value = stripParenExpression(expression);
    const receiver = isNodeOfType(value, "MemberExpression") ? value.object : value;
    return isNodeOfType(receiver, "Identifier") && scopes.symbolFor(receiver) === eventSymbol;
  };
  const value = stripParenExpression(argument);
  if (!isNodeOfType(value, "ObjectExpression")) return readsEvent(value);
  const keys = new Set<string>();
  let containsEventValue = false;
  for (const property of value.properties) {
    if (!isNodeOfType(property, "Property") || property.kind !== "init") return false;
    const key = getStaticPropertyKeyName(property);
    if (key === null || keys.has(key)) return false;
    keys.add(key);
    containsEventValue ||= readsEvent(property.value);
  }
  return containsEventValue;
};

const getCallStatement = (statement: EsTreeNode | undefined): EsTreeNode | undefined =>
  isNodeOfType(statement, "ExpressionStatement") ? statement.expression : statement;

const getObserverCallback = (
  write: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): EsTreeNode | null => {
  const writer = findEnclosingFunction(write);
  if (!isFunctionLike(writer)) return null;
  const writerRoot = findTransparentExpressionRoot(writer);
  const parent = writerRoot.parent;
  if (!isNodeOfType(parent, "NewExpression") && !isNodeOfType(parent, "CallExpression")) {
    return null;
  }
  const callback = isNodeOfType(parent, "NewExpression") ? writer : findEnclosingFunction(writer);
  if (!isFunctionLike(callback)) return null;
  const callbackRoot = findTransparentExpressionRoot(callback);
  if (
    !isNodeOfType(callbackRoot.parent, "NewExpression") ||
    callbackRoot.parent.arguments[0] !== callbackRoot ||
    ("generator" in callback && callback.generator)
  ) {
    return null;
  }
  if (callback.async) return null;

  const eventValue = writer.params[0];
  if (!isNodeOfType(eventValue, "Identifier")) return null;
  if (
    !carriesEventValue(write.arguments[0], eventValue, context.scopes) ||
    !isNodeReachableWithinFunction(write, context)
  ) {
    return null;
  }
  if (writer === callback) return callback;

  // Native observer delivery supplies an array. Follow only its immediate
  // forEach callback, where each argument is an entry from the same delivery.
  if (
    writer.async ||
    ("generator" in writer && writer.generator) ||
    !isNodeOfType(parent, "CallExpression") ||
    parent.optional ||
    parent.arguments[0] !== writerRoot ||
    !isNodeReachableWithinFunction(parent, context)
  ) {
    return null;
  }
  const iterator = parent.callee;
  const entries = callback.params[0];
  if (
    !isNodeOfType(entries, "Identifier") ||
    !isNodeOfType(iterator, "MemberExpression") ||
    iterator.optional ||
    iterator.computed ||
    !isNodeOfType(iterator.property, "Identifier") ||
    iterator.property.name !== "forEach" ||
    !isNodeOfType(iterator.object, "Identifier")
  ) {
    return null;
  }
  const entriesSymbol = context.scopes.symbolFor(entries);
  if (
    !entriesSymbol ||
    entriesSymbol.references.length !== 1 ||
    entriesSymbol.references[0].identifier !== iterator.object ||
    entriesSymbol.references[0].flag !== "read"
  ) {
    return null;
  }
  return callback;
};

const getObserverMethodReceiver = (
  call: EsTreeNode | undefined,
  name: string,
  arity: number,
): EsTreeNodeOfType<"Identifier"> | null => {
  if (!isNodeOfType(call, "CallExpression") || call.optional || call.arguments.length !== arity) {
    return null;
  }
  const member = call.callee;
  return isNodeOfType(member, "MemberExpression") &&
    !member.optional &&
    !member.computed &&
    isNodeOfType(member.property, "Identifier") &&
    member.property.name === name &&
    isNodeOfType(member.object, "Identifier")
    ? member.object
    : null;
};

const getCleanupReceiver = (statement: EsTreeNode | undefined) => {
  if (!isNodeOfType(statement, "ReturnStatement") || !isFunctionLike(statement.argument)) {
    return null;
  }
  const statements = getCallbackStatements(statement.argument);
  return statements.length === 1
    ? getObserverMethodReceiver(getCallStatement(statements[0]), "disconnect", 0)
    : null;
};

const isElementType = (type: EsTreeNode | undefined | null, scopes: ScopeAnalysis): boolean => {
  if (!isNodeOfType(type, "TSTypeReference") || !isNodeOfType(type.typeName, "Identifier")) {
    return false;
  }
  const name = type.typeName.name;
  return (
    /^(?:(?:HTML|SVG)[A-Za-z0-9]*)?Element$/.test(name) &&
    !hasVisibleBindingNamed(type, name, scopes) &&
    !hasEnclosingTypeParameterNamed(type, name)
  );
};

const canSupplyElement = (
  declaration: EsTreeNodeOfType<"VariableDeclarator">,
  setter: EsTreeNode | null | undefined,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isNodeOfType(setter, "Identifier")) return false;
  const symbol = scopes.symbolFor(setter);
  const owner = findEnclosingFunction(declaration);
  if (!symbol || !owner) return false;
  const isReturn = (value: EsTreeNode): boolean => {
    const root = findTransparentExpressionRoot(value);
    return (
      isNodeOfType(root.parent, "ReturnStatement") &&
      root.parent.argument === root &&
      isNodeOfType(root.parent.parent, "BlockStatement") &&
      root.parent.parent.parent === owner
    );
  };
  return symbol.references.some(({ identifier, flag }) => {
    if (flag !== "read") return false;
    const root = findTransparentExpressionRoot(identifier);
    const consumer = root.parent;
    const container =
      isNodeOfType(consumer, "Property") && consumer.value === root ? consumer.parent : consumer;
    if (
      !isNodeOfType(container, "ArrayExpression") &&
      !isNodeOfType(container, "ObjectExpression")
    ) {
      return isReturn(root);
    }
    let slot: string | null;
    const isTuple = isNodeOfType(container, "ArrayExpression");
    if (isTuple) {
      if (container.elements.some((element) => isNodeOfType(element, "SpreadElement"))) {
        return false;
      }
      slot = String(container.elements.findIndex((element) => element === root));
    } else {
      if (!isNodeOfType(consumer, "Property") || consumer.kind !== "init") return false;
      slot = getStaticPropertyKeyName(consumer);
      if (
        slot === null ||
        container.properties.some(
          (property) =>
            property !== consumer &&
            (!isNodeOfType(property, "Property") ||
              getStaticPropertyKeyName(property) === null ||
              getStaticPropertyKeyName(property) === slot),
        )
      ) {
        return false;
      }
    }
    if (isReturn(container)) return true;
    const value = findTransparentExpressionRoot(container);
    const binding = value.parent;
    if (
      !isNodeOfType(binding, "VariableDeclarator") ||
      binding.init !== value ||
      !isNodeOfType(binding.id, "Identifier")
    ) {
      return false;
    }
    const result = scopes.symbolFor(binding.id);
    if (result?.kind !== "const") return false;
    return result.references.some(
      ({ identifier: returnedValue, flag: useFlag }) =>
        useFlag === "read" &&
        isReturn(returnedValue) &&
        !hasPossibleStaticPropertyMutationOrEscapeBefore(binding.id, slot, returnedValue, scopes) &&
        (!isTuple ||
          !hasPossibleStaticPropertyMutationOrEscapeBefore(
            binding.id,
            "length",
            returnedValue,
            scopes,
          )),
    );
  });
};

const canObserveTarget = (
  target: EsTreeNode | undefined,
  precedingStatements: readonly EsTreeNode[],
  scopes: ScopeAnalysis,
): boolean => {
  if (!isNodeOfType(target, "Identifier")) return false;
  const symbol = resolveConstIdentifierAlias(target, scopes, true);
  if (!symbol) return false;
  if (symbol.kind === "parameter") {
    return (
      isElementType(getSymbolTypeAnnotation(symbol), scopes) &&
      symbol.references.every(({ flag }) => flag === "read")
    );
  }
  const declaration = symbol.declarationNode;
  if (
    symbol.kind !== "const" ||
    !isNodeOfType(declaration, "VariableDeclarator") ||
    !isNodeOfType(declaration.id, "ArrayPattern") ||
    declaration.id.elements[0] !== symbol.bindingIdentifier ||
    !isNodeOfType(declaration.init, "CallExpression") ||
    !isReactApiCall(declaration.init, "useState", scopes, { resolveNamedAliases: true })
  ) {
    return false;
  }

  const type = declaration.init.typeArguments?.params[0];
  const nullableElementType =
    isNodeOfType(type, "TSUnionType") &&
    type.types.some((member) => isElementType(member, scopes)) &&
    type.types.every(
      (member) =>
        isElementType(member, scopes) ||
        isNodeOfType(member, "TSNullKeyword") ||
        isNodeOfType(member, "TSUndefinedKeyword"),
    );
  if (
    (!isElementType(type, scopes) && !nullableElementType) ||
    !canSupplyElement(declaration, declaration.id.elements[1], scopes)
  ) {
    return false;
  }

  // The hook exposes the ref callback and skips registration until there is an element.
  return precedingStatements.some((statement) => {
    if (
      !isNodeOfType(statement, "IfStatement") ||
      statement.alternate ||
      !isNodeOfType(statement.test, "UnaryExpression") ||
      statement.test.operator !== "!" ||
      scopes.symbolFor(statement.test.argument) !== symbol
    ) {
      return false;
    }
    return isNodeOfType(statement.consequent, "ReturnStatement");
  });
};

const isObserverThresholdRead = (
  member: EsTreeNodeOfType<"MemberExpression">,
  scopes: ScopeAnalysis,
): boolean => {
  if (getStaticPropertyName(member) !== "thresholds" || isWithinAssignmentTarget(member))
    return false;
  let value = findTransparentExpressionRoot(member);
  if (isNativeArrayIsArrayCall(value.parent, scopes)) return true;

  // Allow a local snapshot of the native threshold array, including the usual
  // conditional normalization into an array, when it is only read via some.
  while (
    (isNodeOfType(value.parent, "ConditionalExpression") && value.parent.test !== value) ||
    isNodeOfType(value.parent, "ArrayExpression")
  ) {
    value = findTransparentExpressionRoot(value.parent);
  }
  const binding = value.parent;
  if (
    !isNodeOfType(binding, "VariableDeclarator") ||
    binding.init !== value ||
    !isNodeOfType(binding.id, "Identifier")
  ) {
    return false;
  }
  const symbol = scopes.symbolFor(binding.id);
  return Boolean(
    symbol?.kind === "const" &&
    symbol.references.every(({ identifier, flag }) => {
      if (identifier === binding.id) return true;
      const method = identifier.parent;
      const call = method?.parent;
      if (
        flag !== "read" ||
        !isNodeOfType(method, "MemberExpression") ||
        method.object !== identifier ||
        getStaticPropertyName(method) !== "some" ||
        !isNodeOfType(call, "CallExpression") ||
        call.callee !== method ||
        call.arguments.length !== 1
      ) {
        return false;
      }
      const callback = call.arguments[0];
      return isNodeOfType(callback, "ArrowFunctionExpression") && callback.params.length === 1;
    }),
  );
};

export const isRegisteredIntersectionObserverWriter = (
  identifier: EsTreeNode,
  componentFunction: EsTreeNode,
  context: RuleContext,
): boolean => {
  const write = identifier.parent;
  if (!isNodeOfType(write, "CallExpression") || write.optional || write.callee !== identifier) {
    return false;
  }
  const callback = getObserverCallback(write, context);
  if (!callback) return false;
  const callbackRoot = findTransparentExpressionRoot(callback);
  const construction = callbackRoot.parent;
  if (
    !isNodeOfType(construction, "NewExpression") ||
    construction.arguments[0] !== callbackRoot ||
    !isProvenGlobalNamespaceReference(
      construction.callee,
      "IntersectionObserver",
      context.scopes,
    ) ||
    !hasClosedObserverProviders(context.scopes)
  ) {
    return false;
  }

  const initializer = findTransparentExpressionRoot(construction);
  const declarator = initializer.parent;
  const declaration = declarator?.parent;
  const block = declaration?.parent;
  const setup = block?.parent;
  const effect = setup?.parent;
  if (
    !isNodeOfType(declarator, "VariableDeclarator") ||
    declarator.init !== initializer ||
    !isNodeOfType(declarator.id, "Identifier") ||
    !isNodeOfType(declaration, "VariableDeclaration") ||
    declaration.kind !== "const" ||
    declaration.declarations.length !== 1 ||
    !isNodeOfType(block, "BlockStatement") ||
    !isFunctionLike(setup) ||
    setup.body !== block ||
    !isNodeOfType(effect, "CallExpression") ||
    effect.arguments[0] !== setup ||
    findEnclosingFunction(effect) !== componentFunction ||
    !isReactApiCall(effect, EFFECT_HOOK_NAMES, context.scopes, { resolveNamedAliases: true }) ||
    !isNodeReachableWithinFunction(effect, context)
  ) {
    return false;
  }

  const setupStatements = getCallbackStatements(setup);
  const declarationIndex = setupStatements.indexOf(declaration);
  const tail = setupStatements.slice(declarationIndex + 1);
  const observeCall = getCallStatement(tail[0]);
  const observeReceiver = getObserverMethodReceiver(observeCall, "observe", 1);
  const cleanupReceiver = getCleanupReceiver(tail[1]);
  const instance = context.scopes.symbolFor(declarator.id);
  if (
    !observeReceiver ||
    !isNodeOfType(observeCall, "CallExpression") ||
    !canObserveTarget(
      observeCall.arguments[0],
      setupStatements.slice(0, declarationIndex),
      context.scopes,
    ) ||
    !isNodeReachableWithinFunction(observeCall, context) ||
    tail.length > (cleanupReceiver ? 2 : 1) ||
    !instance ||
    context.scopes.symbolFor(observeReceiver) !== instance ||
    (cleanupReceiver && context.scopes.symbolFor(cleanupReceiver) !== instance) ||
    !hasCompleteSymbolReferences(instance, context.scopes.rootScope.node, context.scopes)
  ) {
    return false;
  }

  // Only allow the registration, returned teardown, and threshold reads.
  // An escaped instance or an early disconnect can prevent native delivery.
  return instance.references.every(({ identifier: reference, flag }) => {
    if (flag !== "read") return reference === declarator.id;
    if (reference === observeReceiver || reference === cleanupReceiver) return true;
    const member = reference.parent;
    return (
      isNodeOfType(member, "MemberExpression") &&
      member.object === reference &&
      isAstDescendant(member, callback) &&
      isObserverThresholdRead(member, context.scopes)
    );
  });
};
