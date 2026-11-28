import { EFFECT_HOOK_NAMES } from "../../../constants/react.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { getFunctionBindingIdentifier } from "../../../utils/get-function-binding-name.js";
import { getSingleReturnExpression } from "../../../utils/get-single-return-expression.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { getSymbolTypeAnnotation } from "../../../utils/get-symbol-type-annotation.js";
import { getSymbolMutationInspector } from "../../../utils/get-symbol-mutation-inspector.js";
import { isAstDescendant } from "../../../utils/is-ast-descendant.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeReachableWithinFunction } from "../../../utils/is-node-reachable-within-function.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isReactApiCall } from "../../../utils/is-react-api-call.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../../utils/rule-context.js";

interface NativeResizeOperation {
  listener: EsTreeNodeOfType<"Identifier">;
  capture: boolean;
}

const onlyStatementOrExpression = (node: EsTreeNode): EsTreeNode | undefined =>
  isNodeOfType(node, "BlockStatement") ? (node.body.length === 1 ? node.body[0] : undefined) : node;

const getDirectCall = (node: EsTreeNode | undefined): EsTreeNodeOfType<"CallExpression"> | null => {
  if (!node) return null;
  const expression = stripParenExpression(
    isNodeOfType(node, "ExpressionStatement") ? node.expression : node,
  );
  return isNodeOfType(expression, "CallExpression") && !expression.optional ? expression : null;
};

const isWindowMember = (
  node: EsTreeNode,
  context: RuleContext,
): node is EsTreeNodeOfType<"MemberExpression"> => {
  if (!isNodeOfType(node, "MemberExpression") || node.optional) return false;
  const receiver = stripParenExpression(node.object);
  return (
    isNodeOfType(receiver, "Identifier") &&
    receiver.name === "window" &&
    context.scopes.isGlobalReference(receiver)
  );
};

const readResizeOperation = (
  call: EsTreeNodeOfType<"CallExpression">,
  methodName: "addEventListener" | "removeEventListener",
  context: RuleContext,
): NativeResizeOperation | null => {
  const member = stripParenExpression(call.callee);
  if (
    !isWindowMember(member, context) ||
    getStaticPropertyName(member) !== methodName ||
    call.arguments.length > 3
  )
    return null;
  const [event, listener, capture] = call.arguments;
  if (
    !isNodeOfType(event, "Literal") ||
    event.value !== "resize" ||
    !isNodeOfType(listener, "Identifier") ||
    (capture && (!isNodeOfType(capture, "Literal") || typeof capture.value !== "boolean"))
  )
    return null;
  return { listener, capture: capture ? Boolean(capture.value) : false };
};

const WINDOW_INPUT_PROPERTIES = new Set([
  "addEventListener",
  "removeEventListener",
  "innerWidth",
  "innerHeight",
]);
const AMBIENT_GLOBAL_OBJECT_NAMES = new Set(["globalThis", "window", "self", "global"]);
const knownWindowInputsByScope = new WeakMap<RuleContext["scopes"], boolean>();

const hasStableWindowInputs = (context: RuleContext): boolean => {
  const { scopes } = context;
  const cached = knownWindowInputsByScope.get(scopes);
  if (cached !== undefined) return cached;
  const mutations = getSymbolMutationInspector(scopes);
  let stable = true;
  walkAst(scopes.rootScope.node, (node) => {
    if (!stable) return false;
    if (isNodeOfType(node, "MemberExpression")) {
      const property = getStaticPropertyName(node);
      if (
        property === "getPrototypeOf" ||
        property === "setPrototypeOf" ||
        property === "__proto__" ||
        ((property === null || WINDOW_INPUT_PROPERTIES.has(property)) &&
          isWithinAssignmentTarget(node))
      ) {
        stable = false;
        return false;
      }
    }
    if (isNodeOfType(node, "CallExpression")) {
      const [target] = node.arguments;
      const properties = target && mutations.getMutationPropertyNames(target);
      if (
        properties === null ||
        (properties && [...properties].some((property) => WINDOW_INPUT_PROPERTIES.has(property)))
      ) {
        stable = false;
        return false;
      }
    }
    if (!isNodeOfType(node, "Identifier") || !scopes.isGlobalReference(node)) return;
    if (
      node.name === "eval" ||
      node.name === "Function" ||
      node.name === "Window" ||
      node.name === "EventTarget" ||
      WINDOW_INPUT_PROPERTIES.has(node.name)
    ) {
      stable = false;
      return false;
    }
    if (!AMBIENT_GLOBAL_OBJECT_NAMES.has(node.name)) return;
    const root = findTransparentExpressionRoot(node);
    const member = root.parent;
    if (
      !isNodeOfType(member, "MemberExpression") ||
      member.object !== root ||
      isWithinAssignmentTarget(member)
    ) {
      stable = false;
      return false;
    }
    const property = getStaticPropertyName(member);
    stable =
      property !== null &&
      !AMBIENT_GLOBAL_OBJECT_NAMES.has(property) &&
      property !== "eval" &&
      property !== "Function" &&
      property !== "Window" &&
      property !== "EventTarget";
  });
  knownWindowInputsByScope.set(scopes, stable);
  return stable;
};

const writesIndependentResizeValue = (
  call: EsTreeNodeOfType<"CallExpression">,
  hasNumericState: boolean,
  context: RuleContext,
): boolean => {
  const [argument] = call.arguments;
  if (!argument || call.arguments.length !== 1) return false;
  const value = stripParenExpression(argument);
  if (isWindowMember(value, context)) {
    const property = getStaticPropertyName(value);
    return property === "innerWidth" || property === "innerHeight";
  }
  if (
    !hasNumericState ||
    !isFunctionLike(value) ||
    value.async ||
    value.generator ||
    value.params.length !== 1
  )
    return false;
  const [previous] = value.params;
  const returned = getSingleReturnExpression(value);
  const update = returned && stripParenExpression(returned);
  return (
    isNodeOfType(previous, "Identifier") &&
    isNodeOfType(update, "BinaryExpression") &&
    (update.operator === "+" || update.operator === "-") &&
    isNodeOfType(update.left, "Identifier") &&
    context.scopes.symbolFor(update.left)?.bindingIdentifier === previous &&
    isNodeOfType(update.right, "Literal") &&
    typeof update.right.value === "number" &&
    Number.isFinite(update.right.value) &&
    update.right.value !== 0
  );
};

const isMountedResizeListener = (
  listener: EsTreeNode,
  component: EsTreeNode,
  context: RuleContext,
): boolean => {
  if (
    !isFunctionLike(listener) ||
    listener.async ||
    listener.generator ||
    listener.params.length !== 0
  )
    return false;
  const setup = findEnclosingFunction(listener);
  if (
    !setup ||
    !isFunctionLike(setup) ||
    setup.async ||
    setup.generator ||
    setup.params.length !== 0 ||
    !isNodeOfType(setup.body, "BlockStatement")
  )
    return false;
  const setupRoot = findTransparentExpressionRoot(setup);
  const effect = setupRoot.parent;
  if (
    !isNodeOfType(effect, "CallExpression") ||
    effect.optional ||
    effect.arguments[0] !== setupRoot ||
    !isReactApiCall(effect, EFFECT_HOOK_NAMES, context.scopes) ||
    findEnclosingFunction(effect) !== component ||
    !isNodeReachableWithinFunction(effect, context)
  )
    return false;

  if (setup.body.body.length !== 3) return false;
  const [listenerDeclaration, registerStatement, cleanupReturn] = setup.body.body;
  if (
    !isNodeOfType(registerStatement, "ExpressionStatement") ||
    !isNodeOfType(cleanupReturn, "ReturnStatement") ||
    !cleanupReturn.argument
  )
    return false;
  const register = getDirectCall(registerStatement);
  if (!register || !isNodeReachableWithinFunction(register, context)) return false;
  const registration = readResizeOperation(register, "addEventListener", context);
  const cleanup = stripParenExpression(cleanupReturn.argument);
  if (
    !registration ||
    !isFunctionLike(cleanup) ||
    cleanup.async ||
    cleanup.generator ||
    cleanup.params.length !== 0
  )
    return false;
  const remove = getDirectCall(onlyStatementOrExpression(cleanup.body));
  const removal = remove && readResizeOperation(remove, "removeEventListener", context);
  const binding = getFunctionBindingIdentifier(listener);
  const symbol = context.scopes.symbolFor(registration.listener);
  const ownedFunction =
    symbol?.kind === "function"
      ? symbol.declarationNode
      : symbol && getDirectConstInitializer(symbol);
  if (
    !symbol ||
    symbol.bindingIdentifier !== binding ||
    symbol.references.length !== 2 ||
    !ownedFunction ||
    stripParenExpression(ownedFunction) !== listener
  )
    return false;
  const hasSingleListenerDeclaration =
    symbol.declarationNode === listenerDeclaration ||
    (isNodeOfType(listenerDeclaration, "VariableDeclaration") &&
      listenerDeclaration.declarations.length === 1 &&
      symbol.declarationNode.parent === listenerDeclaration);
  if (!hasSingleListenerDeclaration) return false;
  return Boolean(
    removal &&
    registration.capture === removal.capture &&
    context.scopes.symbolFor(registration.listener) === symbol &&
    context.scopes.symbolFor(removal.listener) === symbol &&
    symbol.references.every(
      ({ identifier }) => identifier === registration.listener || identifier === removal.listener,
    ),
  );
};

export const hasNativeResizeStateWriter = (
  stateDeclarator: EsTreeNode,
  originalEffect: EsTreeNode,
  originalWrite: EsTreeNode,
  context: RuleContext,
): boolean => {
  if (
    !isNodeOfType(stateDeclarator, "VariableDeclarator") ||
    !isNodeOfType(stateDeclarator.id, "ArrayPattern")
  )
    return false;
  const setter = stateDeclarator.id.elements[1];
  const symbol = setter && context.scopes.symbolFor(setter);
  const component = findEnclosingFunction(originalEffect);
  if (
    !symbol ||
    symbol.kind !== "const" ||
    !component ||
    symbol.references.some(({ flag }) => flag !== "read")
  )
    return false;
  const initial = stateDeclarator.init && stripParenExpression(stateDeclarator.init);
  const seed = isNodeOfType(initial, "CallExpression") && initial.arguments[0];
  const source = isNodeOfType(originalWrite, "CallExpression") ? originalWrite.arguments[0] : null;
  const sourceSymbol = isNodeOfType(source, "Identifier") ? context.scopes.symbolFor(source) : null;
  const copiesNumber =
    isNodeOfType(seed, "Literal") &&
    typeof seed.value === "number" &&
    sourceSymbol &&
    isNodeOfType(getSymbolTypeAnnotation(sourceSymbol), "TSNumberKeyword") &&
    sourceSymbol.references.every(
      ({ flag, identifier }) => flag === "read" && !isWithinAssignmentTarget(identifier),
    );
  return symbol.references.some(({ identifier }) => {
    if (isAstDescendant(identifier, originalEffect)) return false;
    const root = findTransparentExpressionRoot(identifier);
    const call = root.parent;
    if (!isNodeOfType(call, "CallExpression") || call.callee !== root || call.optional)
      return false;
    const listener = findEnclosingFunction(call);
    const hasNumericState = Boolean(
      copiesNumber &&
      symbol.references.every((reference) => {
        const use = findTransparentExpressionRoot(reference.identifier);
        return use.parent === originalWrite || use.parent === call;
      }),
    );
    return Boolean(
      listener &&
      isFunctionLike(listener) &&
      getDirectCall(onlyStatementOrExpression(listener.body)) === call &&
      writesIndependentResizeValue(call, hasNumericState, context) &&
      isMountedResizeListener(listener, component, context) &&
      hasStableWindowInputs(context),
    );
  });
};
