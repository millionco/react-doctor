import { EFFECT_HOOK_NAMES, EVENT_LISTENER_ARGUMENT_COUNT } from "../constants/react.js";
import type { SymbolDescriptor } from "../semantic/scope-analysis.js";
import { findProgramRoot } from "./find-program-root.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getDirectConstInitializer } from "./get-direct-const-initializer.js";
import { getStaticKeyName } from "./get-static-key-name.js";
import { hasDeclaredCallableListenerResult } from "./has-declared-callable-listener-result.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isReactApiCall } from "./is-react-api-call.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { RuleContext } from "./rule-context.js";

const callableContractBySymbol = new WeakMap<SymbolDescriptor, boolean>();
const closedFactoryByDeclaration = new WeakMap<EsTreeNode, boolean>();

const hasClosedDeclaredFactory = (
  factory: EsTreeNode,
  factoryName: string,
  program: EsTreeNode,
  context: RuleContext,
): boolean => {
  const cached = closedFactoryByDeclaration.get(factory);
  if (cached !== undefined) return cached;
  let isClosedFactory = true;
  walkAst(program, (candidate) => {
    if (!isClosedFactory) return false;
    if (
      isNodeOfType(candidate, "WithStatement") ||
      isNodeOfType(candidate, "TSModuleDeclaration")
    ) {
      isClosedFactory = false;
      return false;
    }
    if (
      isNodeOfType(candidate, "TSMethodSignature") &&
      getStaticKeyName(candidate.key) === "addListener" &&
      candidate.kind !== "method"
    ) {
      isClosedFactory = false;
      return false;
    }
    if (!isNodeOfType(candidate, "Identifier")) return;
    if (
      candidate.name === "eval" ||
      candidate.name === "Function" ||
      ((candidate.name === "globalThis" ||
        candidate.name === "window" ||
        candidate.name === "self" ||
        candidate.name === "global") &&
        context.scopes.isGlobalReference(candidate))
    ) {
      isClosedFactory = false;
      return false;
    }
    if (
      candidate.name !== factoryName ||
      (isNodeOfType(factory, "TSDeclareFunction") && candidate === factory.id)
    )
      return;
    const parent = candidate.parent;
    if (
      !isNodeOfType(parent, "CallExpression") ||
      parent.callee !== candidate ||
      parent.optional ||
      parent.typeArguments ||
      parent.arguments.length !== 0 ||
      !context.scopes.isGlobalReference(candidate)
    )
      isClosedFactory = false;
  });
  closedFactoryByDeclaration.set(factory, isClosedFactory);
  return isClosedFactory;
};

const hasDeclaredCallableListenerReceiver = (
  receiver: EsTreeNode,
  receiverSymbol: SymbolDescriptor,
  context: RuleContext,
): boolean => {
  if (!isNodeOfType(receiver, "Identifier")) return false;
  const initializer = getDirectConstInitializer(receiverSymbol);
  const factoryCall = initializer ? stripParenExpression(initializer) : null;
  if (
    !isNodeOfType(factoryCall, "CallExpression") ||
    factoryCall.optional ||
    factoryCall.arguments.length !== 0 ||
    factoryCall.typeArguments ||
    !isNodeOfType(factoryCall.callee, "Identifier") ||
    !context.scopes.isGlobalReference(factoryCall.callee)
  )
    return false;
  const program = findProgramRoot(receiver);
  if (!isNodeOfType(program, "Program")) return false;
  const factoryName = factoryCall.callee.name;
  const factories = program.body.filter(
    (statement) =>
      isNodeOfType(statement, "TSDeclareFunction") && statement.id?.name === factoryName,
  );
  if (factories.length !== 1) return false;
  const factory = factories[0];
  if (
    !isNodeOfType(factory, "TSDeclareFunction") ||
    !factory.declare ||
    factory.async ||
    factory.generator ||
    factory.typeParameters ||
    factory.params.length !== 0 ||
    !factory.returnType
  )
    return false;
  if (
    !hasDeclaredCallableListenerResult(factoryCall, context) ||
    !hasClosedDeclaredFactory(factory, factoryName, program, context)
  )
    return false;
  const receiverReferences = new Set(
    receiverSymbol.references.map((reference) => reference.identifier),
  );
  let isClosedContract = true;
  walkAst(receiverSymbol.scope.node, (candidate) => {
    if (!isClosedContract) return false;
    if (!isNodeOfType(candidate, "Identifier")) return;
    if (candidate.name !== receiver.name || candidate === receiverSymbol.bindingIdentifier) return;
    if (!receiverReferences.has(candidate)) {
      isClosedContract = false;
      return;
    }
    const referenceRoot = findTransparentExpressionRoot(candidate);
    const parent = referenceRoot.parent;
    if (isNodeOfType(parent, "ArrayExpression")) {
      const effectCall = parent.parent;
      isClosedContract =
        isNodeOfType(effectCall, "CallExpression") &&
        !effectCall.optional &&
        effectCall.arguments[1] === parent &&
        (isReactApiCall(effectCall, EFFECT_HOOK_NAMES, context.scopes) ||
          isReactApiCall(effectCall, "useInsertionEffect", context.scopes));
      return;
    }
    const memberRoot = parent ? findTransparentExpressionRoot(parent) : null;
    const invocation = memberRoot?.parent;
    if (
      !isNodeOfType(parent, "MemberExpression") ||
      parent.object !== referenceRoot ||
      parent.computed ||
      parent.optional ||
      !isNodeOfType(parent.property, "Identifier") ||
      parent.property.name !== "addListener" ||
      !isNodeOfType(invocation, "CallExpression") ||
      invocation.callee !== memberRoot ||
      invocation.optional
    )
      isClosedContract = false;
  });
  return isClosedContract;
};

export const hasDeclaredCallableListenerRegistration = (
  node: EsTreeNode,
  context: RuleContext,
): boolean => {
  if (
    !isNodeOfType(node, "CallExpression") ||
    node.optional ||
    node.arguments.length !== EVENT_LISTENER_ARGUMENT_COUNT
  )
    return false;
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
  if (!isNodeOfType(receiver, "Identifier")) return false;
  const symbol = context.scopes.symbolFor(receiver);
  if (!symbol) return false;
  const cached = callableContractBySymbol.get(symbol);
  if (cached !== undefined) return cached;
  const result = hasDeclaredCallableListenerReceiver(receiver, symbol, context);
  callableContractBySymbol.set(symbol, result);
  return result;
};
