import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getResolvedStaticPropertyName } from "../../../utils/get-resolved-static-property-name.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { isKeyedDraftTypeReference } from "../../../utils/is-keyed-draft-type-reference.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isProvenGlobalObjectReference } from "../../../utils/is-proven-global-namespace-reference.js";
import { isProvenUnmodifiedGlobalNamespaceReference } from "../../../utils/is-proven-unmodified-global-namespace-reference.js";
import { isSymbolReadOnly } from "../../../utils/is-symbol-read-only.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";

const globalObjectNames = new Set(["global", "globalThis", "self", "window"]);
const receiverGlobals = new Set([
  "BroadcastChannel",
  "EventTarget",
  "defaultView",
  "eval",
  "event",
]);
const listenerMethods = new Set(["addEventListener", "removeEventListener", "postMessage"]);
const hasStableChannelByAccessor = new WeakMap<SymbolDescriptor, boolean>();

const getModuleFunction = (symbol: SymbolDescriptor | null, scopes: ScopeAnalysis) => {
  const declaration = symbol?.declarationNode;
  return symbol &&
    isNodeOfType(declaration, "FunctionDeclaration") &&
    declaration.parent === scopes.rootScope.node &&
    !declaration.async &&
    !declaration.generator &&
    declaration.params.length === 0 &&
    isSymbolReadOnly(symbol) &&
    hasCompleteSymbolReferences(symbol, scopes.rootScope.node, scopes)
    ? declaration
    : null;
};

const getDirectCall = (reference: EsTreeNode) => {
  const consumer = reference.parent;
  return isNodeOfType(consumer, "CallExpression") &&
    consumer.callee === reference &&
    !consumer.optional &&
    consumer.arguments.length === 0
    ? consumer
    : null;
};

const isCallOfReceiverMethod = (
  expression: EsTreeNode,
  methods: ReadonlySet<string>,
  scopes: ScopeAnalysis,
): boolean => {
  const member = expression.parent;
  if (
    !isNodeOfType(member, "MemberExpression") ||
    member.object !== expression ||
    member.optional ||
    !methods.has(getStaticPropertyName(member) ?? "") ||
    !isNodeOfType(member.parent, "CallExpression") ||
    member.parent.callee !== member ||
    member.parent.optional
  )
    return false;
  if (getStaticPropertyName(member) !== "addEventListener") return true;
  const handler = member.parent.arguments[1];
  if (!isNodeOfType(handler, "Identifier")) return false;
  const callback = scopes.symbolFor(handler);
  const initializer = callback?.initializer;
  // Event listeners can receive their endpoint through the event or through `this`.
  return Boolean(
    callback?.kind === "const" &&
    isSymbolReadOnly(callback) &&
    isNodeOfType(initializer, "ArrowFunctionExpression") &&
    initializer.params.length === 0,
  );
};

const isInertChannel = (expression: EsTreeNode): boolean => {
  const object = stripParenExpression(expression);
  if (!isNodeOfType(object, "ObjectExpression")) return false;
  const names = new Set<string>();
  for (const property of object.properties) {
    if (!isNodeOfType(property, "Property") || property.kind !== "init" || property.computed)
      return false;
    const name = getStaticPropertyKeyName(property);
    if (!name || name === "__proto__" || names.has(name)) return false;
    names.add(name);
    const value = property.value;
    const inertFunction =
      (isNodeOfType(value, "ArrowFunctionExpression") ||
        isNodeOfType(value, "FunctionExpression")) &&
      !value.async &&
      value.params.length === 0 &&
      (isNodeOfType(value.body, "Literal") ||
        (isNodeOfType(value.body, "BlockStatement") && value.body.body.length === 0));
    if (
      listenerMethods.has(name) ? !inertFunction : !inertFunction && !isNodeOfType(value, "Literal")
    )
      return false;
  }
  return [...listenerMethods].every((name) => names.has(name));
};

const getUnavailableChannelCheck = (statement: EsTreeNode | undefined): EsTreeNode | null => {
  if (
    !isNodeOfType(statement, "IfStatement") ||
    statement.alternate ||
    !isNodeOfType(statement.test, "BinaryExpression") ||
    statement.test.operator !== "===" ||
    !isNodeOfType(statement.test.left, "UnaryExpression") ||
    statement.test.left.operator !== "typeof" ||
    !isNodeOfType(statement.test.right, "Literal") ||
    statement.test.right.value !== "undefined" ||
    !isNodeOfType(statement.consequent, "BlockStatement") ||
    statement.consequent.body.length !== 1
  )
    return null;
  const returned = statement.consequent.body[0];
  return isNodeOfType(returned, "ReturnStatement") &&
    returned.argument &&
    isInertChannel(returned.argument)
    ? statement.test.left.argument
    : null;
};

const isUnsafeReceiverMember = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (isNodeOfType(node, "Property") && isNodeOfType(node.parent, "ObjectPattern")) {
    const name = getStaticPropertyKeyName(node);
    return (
      name !== null &&
      ((name !== "event" && receiverGlobals.has(name)) || listenerMethods.has(name))
    );
  }
  if (
    isNodeOfType(node, "Literal") &&
    typeof node.value === "string" &&
    listenerMethods.has(node.value)
  ) {
    // A method name passed as data can be used to replace an inherited method.
    return !isNodeOfType(node.parent, "MemberExpression") || node.parent.property !== node;
  }
  if (!isNodeOfType(node, "MemberExpression")) return false;
  const name = getResolvedStaticPropertyName(node, scopes, { allowConstTemplateLiteral: true });
  if (name === null) {
    return isWithinAssignmentTarget(node) || isProvenGlobalObjectReference(node.object, scopes);
  }
  if (receiverGlobals.has(name)) return true;
  if (
    name === "assign" ||
    name === "defineProperties" ||
    name === "defineProperty" ||
    name === "setPrototypeOf"
  )
    return true;
  if (!listenerMethods.has(name)) return false;
  const reference = findTransparentExpressionRoot(node);
  return !isNodeOfType(reference.parent, "CallExpression") || reference.parent.callee !== reference;
};

const hasNativeChannelConstructor = (
  allocator: EsTreeNodeOfType<"FunctionDeclaration">,
  scopes: ScopeAnalysis,
): boolean => {
  const statements = allocator.body.body;
  if (statements.length !== 1 && statements.length !== 2) return false;
  const returned = statements.at(-1);
  if (
    !isNodeOfType(returned, "ReturnStatement") ||
    !isNodeOfType(returned.argument, "NewExpression")
  )
    return false;
  const construction = returned.argument;
  if (
    !isNodeOfType(construction.callee, "Identifier") ||
    construction.callee.name !== "BroadcastChannel" ||
    construction.arguments.length !== 1 ||
    !isNodeOfType(construction.arguments[0], "Literal") ||
    typeof construction.arguments[0].value !== "string" ||
    !isProvenUnmodifiedGlobalNamespaceReference(
      construction.callee,
      "BroadcastChannel",
      scopes,
      undefined,
      true,
    )
  )
    return false;
  const unavailable = statements.length === 2 ? getUnavailableChannelCheck(statements[0]) : null;
  if (
    statements.length === 2 &&
    (!isNodeOfType(unavailable, "Identifier") ||
      unavailable.name !== "BroadcastChannel" ||
      !scopes.isGlobalReference(unavailable))
  )
    return false;

  // Exclude visible ways to access the native endpoint or replace its methods.
  let closed = true;
  walkAst(scopes.rootScope.node, (node) => {
    if (!closed || isKeyedDraftTypeReference(node)) return false;
    if (
      isNodeOfType(node, "Identifier") &&
      globalObjectNames.has(node.name) &&
      scopes.isGlobalReference(node)
    ) {
      const expression = findTransparentExpressionRoot(node);
      const consumer = expression.parent;
      const isMemberReceiver =
        isNodeOfType(consumer, "MemberExpression") && consumer.object === expression;
      const isTypeofOperand =
        isNodeOfType(consumer, "UnaryExpression") &&
        consumer.operator === "typeof" &&
        consumer.argument === expression;
      if (!isMemberReceiver && !isTypeofOperand) {
        closed = false;
        return false;
      }
    }
    if (
      isNodeOfType(node, "WithStatement") ||
      (isNodeOfType(node, "Identifier") &&
        scopes.isGlobalReference(node) &&
        (node.name === "eval" ||
          node.name === "EventTarget" ||
          node.name === "event" ||
          node.name === "Function" ||
          node.name === "Reflect" ||
          (node.name === "BroadcastChannel" &&
            node !== construction.callee &&
            node !== unavailable))) ||
      isUnsafeReceiverMember(node, scopes)
    ) {
      closed = false;
      return false;
    }
  });
  return closed;
};

const getCachedChannel = (
  accessor: SymbolDescriptor,
  scopes: ScopeAnalysis,
): SymbolDescriptor | null => {
  const declaration = getModuleFunction(accessor, scopes);
  const program = scopes.rootScope.node;
  if (
    !isNodeOfType(program, "Program") ||
    program.sourceType !== "module" ||
    !declaration ||
    declaration.body.body.length !== 2 ||
    !accessor.references.every(({ identifier }) => {
      if (isKeyedDraftTypeReference(identifier)) return true;
      const call = getDirectCall(identifier);
      return call && isCallOfReceiverMethod(call, listenerMethods, scopes);
    })
  )
    return null;

  const [guard, returned] = declaration.body.body;
  if (
    !isNodeOfType(guard, "IfStatement") ||
    guard.alternate ||
    !isNodeOfType(guard.consequent, "BlockStatement") ||
    guard.consequent.body.length !== 1 ||
    !isNodeOfType(guard.test, "BinaryExpression") ||
    guard.test.operator !== "===" ||
    !isNodeOfType(guard.test.left, "Identifier") ||
    !isNodeOfType(guard.test.right, "Literal") ||
    guard.test.right.value !== null ||
    !isNodeOfType(returned, "ReturnStatement") ||
    !isNodeOfType(returned.argument, "Identifier")
  )
    return null;
  const checkedCache = guard.test.left;
  const cache = scopes.symbolFor(returned.argument);
  const cacheDeclaration = cache?.declarationNode;
  if (
    !cache ||
    cache.kind !== "let" ||
    cacheDeclaration?.parent?.parent !== scopes.rootScope.node ||
    !isNodeOfType(cacheDeclaration, "VariableDeclarator") ||
    cacheDeclaration.id !== cache.bindingIdentifier ||
    !isNodeOfType(cacheDeclaration.init, "Literal") ||
    cacheDeclaration.init.value !== null ||
    scopes.symbolFor(checkedCache) !== cache
  )
    return null;

  const assignmentStatement = guard.consequent.body[0];
  const assignment = isNodeOfType(assignmentStatement, "ExpressionStatement")
    ? assignmentStatement.expression
    : null;
  if (
    !isNodeOfType(assignment, "AssignmentExpression") ||
    assignment.operator !== "=" ||
    !isNodeOfType(assignment.left, "Identifier") ||
    scopes.symbolFor(assignment.left) !== cache ||
    !isNodeOfType(assignment.right, "CallExpression") ||
    assignment.right.optional ||
    assignment.right.arguments.length !== 0 ||
    !isNodeOfType(assignment.right.callee, "Identifier")
  )
    return null;
  if (
    cache.references.length !== 3 ||
    !cache.references.every(
      ({ identifier }) =>
        identifier === checkedCache ||
        identifier === returned.argument ||
        identifier === assignment.left,
    ) ||
    !hasCompleteSymbolReferences(cache, scopes.rootScope.node, scopes)
  )
    return null;

  const allocator = scopes.symbolFor(assignment.right.callee);
  const allocatorFunction = getModuleFunction(allocator, scopes);
  if (
    !allocator ||
    !allocatorFunction ||
    !allocator.references.every(({ identifier }) => {
      if (isKeyedDraftTypeReference(identifier)) return true;
      const call = getDirectCall(identifier);
      return (
        call === assignment.right || (call && isCallOfReceiverMethod(call, listenerMethods, scopes))
      );
    }) ||
    !hasNativeChannelConstructor(allocatorFunction, scopes)
  )
    return null;
  return cache;
};

const getReceiverAccessor = (receiver: EsTreeNode, scopes: ScopeAnalysis) => {
  const call = stripParenExpression(receiver);
  return isNodeOfType(call, "CallExpression") &&
    !call.optional &&
    call.arguments.length === 0 &&
    isNodeOfType(call.callee, "Identifier")
    ? scopes.symbolFor(call.callee)
    : null;
};

export const hasMatchingCachedBroadcastChannelReceivers = (
  registration: EsTreeNodeOfType<"CallExpression">,
  release: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
): boolean => {
  const add = stripParenExpression(registration.callee);
  const remove = stripParenExpression(release.callee);
  if (
    !isNodeOfType(add, "MemberExpression") ||
    getStaticPropertyName(add) !== "addEventListener" ||
    !isNodeOfType(remove, "MemberExpression") ||
    getStaticPropertyName(remove) !== "removeEventListener"
  )
    return false;
  const [addEvent, addHandler, addCapture] = registration.arguments;
  const [removeEvent, removeHandler, removeCapture] = release.arguments;
  if (
    !isNodeOfType(addEvent, "Literal") ||
    typeof addEvent.value !== "string" ||
    !isNodeOfType(removeEvent, "Literal") ||
    removeEvent.value !== addEvent.value ||
    !isNodeOfType(addHandler, "Identifier") ||
    !isNodeOfType(removeHandler, "Identifier") ||
    registration.arguments.length > 3 ||
    release.arguments.length > 3 ||
    [addCapture, removeCapture].some(
      (value) => value && (!isNodeOfType(value, "Literal") || typeof value.value !== "boolean"),
    )
  )
    return false;
  const accessor = getReceiverAccessor(add.object, scopes);
  if (!accessor || accessor !== getReceiverAccessor(remove.object, scopes)) return false;
  const handler = scopes.symbolFor(addHandler);
  if (
    !handler ||
    handler !== scopes.symbolFor(removeHandler) ||
    !isSymbolReadOnly(handler) ||
    !hasCompleteSymbolReferences(handler, scopes.rootScope.node, scopes)
  )
    return false;
  const cached = hasStableChannelByAccessor.get(accessor);
  if (cached !== undefined) return cached;
  const hasStableChannel = getCachedChannel(accessor, scopes) !== null;
  hasStableChannelByAccessor.set(accessor, hasStableChannel);
  return hasStableChannel;
};
