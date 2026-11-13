import type { Reference } from "eslint-scope";
import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getCallMethodName } from "../../../utils/get-call-method-name.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { isAstDescendant } from "../../../utils/is-ast-descendant.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isReactApiCall } from "../../../utils/is-react-api-call.js";
import { isSymbolReadOnly } from "../../../utils/is-symbol-read-only.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { getUpstreamRefs } from "./effect/ast.js";
import type { ProgramAnalysis } from "./effect/get-program-analysis.js";
import { isProp, isWholePropsObjectReference } from "./effect/react.js";
import type { OwnedAbortSignalCommandProof } from "./is-owned-abort-signal-command.js";
import { isKnownReactHookDependencyReference } from "./resolve-parent-callback-provenance.js";
import { getStaticMemberPropertyName } from "./static-member-property-name.js";

const CANCELLATION_READ_METHOD_NAMES: ReadonlySet<string> = new Set(["flatMap", "map", "some"]);

interface ClosedCancellationWrapper {
  wrapper: EsTreeNode;
  handoff: EsTreeNodeOfType<"CallExpression">;
  proof: OwnedAbortSignalCommandProof;
  certifiedOccurrences: ReadonlySet<EsTreeNode>;
  isRenderGuard: (call: EsTreeNodeOfType<"CallExpression">) => boolean;
  scalarRefProofs: WeakMap<SymbolDescriptor, boolean>;
  settlementRegistrationProofs: WeakMap<EsTreeNode, boolean>;
  settlerProofs: WeakMap<EsTreeNode, boolean>;
}

const memoizeProof = <Key extends object, Result>(prove: (key: Key) => Result) => {
  const results = new WeakMap<Key, Result>();
  return (key: Key): Result => {
    const cached = results.get(key);
    if (cached !== undefined) return cached;
    const result = prove(key);
    results.set(key, result);
    return result;
  };
};

const isEarlyReturnTest = (expression: EsTreeNode): boolean => {
  const test =
    isNodeOfType(expression.parent, "UnaryExpression") && expression.parent.operator === "!"
      ? expression.parent
      : expression;
  const statement = test.parent;
  return (
    isNodeOfType(statement, "IfStatement") &&
    statement.test === test &&
    isNodeOfType(statement.consequent, "ReturnStatement") &&
    !statement.consequent.argument
  );
};

const isRenderCollectionGuard = (
  call: EsTreeNodeOfType<"CallExpression">,
  wrapper: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const component = findEnclosingFunction(wrapper);
  if (
    !component ||
    findEnclosingFunction(call) !== component ||
    !CANCELLATION_READ_METHOD_NAMES.has(getCallMethodName(call.callee) ?? "")
  )
    return false;
  const declaration = call.parent;
  if (
    !isNodeOfType(declaration, "VariableDeclarator") ||
    !isNodeOfType(declaration.id, "Identifier")
  )
    return false;
  const collection = scopes.symbolFor(declaration.id);
  if (
    !collection ||
    !isSymbolReadOnly(collection) ||
    getDirectConstInitializer(collection) !== call
  )
    return false;
  const onlyGuardsWrapper = (binding: SymbolDescriptor): boolean => {
    const reads = binding.references.filter(({ identifier }) =>
      isAstDescendant(identifier, wrapper),
    );
    return reads.length > 0 && reads.every(({ identifier }) => isEarlyReturnTest(identifier));
  };
  if (onlyGuardsWrapper(collection)) return true;
  if (collection.references.some(({ identifier }) => isAstDescendant(identifier, wrapper)))
    return false;
  return collection.references.some(({ identifier }) => {
    const length = identifier.parent;
    if (
      !isNodeOfType(length, "MemberExpression") ||
      length.object !== identifier ||
      length.computed ||
      getStaticMemberPropertyName(length) !== "length"
    )
      return false;
    const comparison = length.parent;
    if (
      !isNodeOfType(comparison, "BinaryExpression") ||
      comparison.operator !== ">" ||
      comparison.left !== length ||
      !isNodeOfType(comparison.right, "Literal") ||
      comparison.right.value !== 0
    )
      return false;
    const alias = comparison.parent;
    const guard =
      isNodeOfType(alias, "VariableDeclarator") && isNodeOfType(alias.id, "Identifier")
        ? scopes.symbolFor(alias.id)
        : null;
    return Boolean(
      guard &&
      isSymbolReadOnly(guard) &&
      getDirectConstInitializer(guard) === comparison &&
      onlyGuardsWrapper(guard),
    );
  });
};

const getClosedCancellationWrapper = (
  analysis: ProgramAnalysis,
  reference: Reference,
  symbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
  getSignalProof: (call: EsTreeNode) => OwnedAbortSignalCommandProof | null,
): ClosedCancellationWrapper | null => {
  const initializer = isSymbolReadOnly(symbol) ? getDirectConstInitializer(symbol) : null;
  if (
    !isNodeOfType(initializer, "CallExpression") ||
    !initializer.arguments[0] ||
    !isReactApiCall(initializer, "useCallback", scopes)
  )
    return null;
  const wrapper = stripParenExpression(initializer.arguments[0]);
  if (!isFunctionLike(wrapper) || wrapper.params.length > 0) return null;
  const isRenderGuard = memoizeProof((call: EsTreeNodeOfType<"CallExpression">) =>
    isRenderCollectionGuard(call, wrapper, scopes),
  );
  let closed: ClosedCancellationWrapper | null = null;
  for (const upstreamReference of getUpstreamRefs(analysis, reference)) {
    if (!isProp(analysis, upstreamReference)) continue;
    if (isWholePropsObjectReference(analysis, upstreamReference)) return null;
    const identifier = findTransparentExpressionRoot(
      upstreamReference.identifier as unknown as EsTreeNode,
    );
    const consumer = identifier.parent;
    if (consumer?.parent === initializer && isKnownReactHookDependencyReference(identifier, scopes))
      continue;
    if (
      isNodeOfType(consumer, "CallExpression") &&
      consumer.callee === identifier &&
      findEnclosingFunction(consumer) === wrapper
    ) {
      const proof = getSignalProof(consumer);
      if (!proof?.ownedRef || (closed && closed.handoff !== consumer)) return null;
      if (closed === null)
        closed = {
          wrapper,
          handoff: consumer,
          proof,
          certifiedOccurrences: new Set(proof.argumentFunctionReferences),
          isRenderGuard,
          scalarRefProofs: new WeakMap(),
          settlementRegistrationProofs: new WeakMap(),
          settlerProofs: new WeakMap(),
        };
      continue;
    }
    if (isEarlyReturnTest(identifier)) continue;
    const collectionCall = consumer?.parent;
    if (
      isNodeOfType(consumer, "MemberExpression") &&
      consumer.object === identifier &&
      !consumer.computed &&
      !consumer.optional &&
      isNodeOfType(collectionCall, "CallExpression") &&
      collectionCall.callee === consumer &&
      !collectionCall.optional &&
      collectionCall.arguments.length === 1 &&
      isFunctionLike(collectionCall.arguments[0]) &&
      isRenderGuard(collectionCall)
    )
      continue;
    return null;
  }
  return closed;
};

const proveCancellationCompletionRegistration = (
  callback: EsTreeNode,
  handoff: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const call = findTransparentExpressionRoot(callback).parent;
  if (!isNodeOfType(call, "CallExpression") || call.optional || call.arguments.length !== 1)
    return false;
  const callee = call.callee;
  if (!isNodeOfType(callee, "MemberExpression") || callee.optional || callee.computed) return false;
  const method = getStaticMemberPropertyName(callee);
  const receiver = stripParenExpression(callee.object);
  const isCompletion = (value: EsTreeNode): boolean => {
    const binding = scopes.symbolFor(stripParenExpression(value));
    return Boolean(
      binding && isSymbolReadOnly(binding) && getDirectConstInitializer(binding) === handoff,
    );
  };
  if ((method === "then" || method === "catch") && isCompletion(receiver)) return true;
  return (
    method === "catch" &&
    isNodeOfType(receiver, "CallExpression") &&
    !receiver.optional &&
    receiver.arguments.length === 1 &&
    isFunctionLike(receiver.arguments[0]) &&
    isNodeOfType(receiver.callee, "MemberExpression") &&
    !receiver.callee.computed &&
    !receiver.callee.optional &&
    getStaticMemberPropertyName(receiver.callee) === "then" &&
    isCompletion(receiver.callee.object)
  );
};

const isCancellationCompletionRegistration = (
  callback: EsTreeNode,
  { handoff, settlementRegistrationProofs }: ClosedCancellationWrapper,
  scopes: ScopeAnalysis,
): boolean => {
  const cached = settlementRegistrationProofs.get(callback);
  if (cached !== undefined) return cached;
  const proven = proveCancellationCompletionRegistration(callback, handoff, scopes);
  settlementRegistrationProofs.set(callback, proven);
  return proven;
};

const isVoidCancellationContinuation = (
  callback: EsTreeNode,
  settlementCall: EsTreeNode,
  certifiedOccurrences: ReadonlySet<EsTreeNode>,
): boolean => {
  if (
    !isFunctionLike(callback) ||
    callback.async ||
    callback.generator ||
    callback.params.length > 0
  )
    return false;
  const isAbortTest = (node: EsTreeNode): boolean => {
    const test =
      isNodeOfType(node, "UnaryExpression") && node.operator === "!" ? node.argument : node;
    return (
      isNodeOfType(test, "MemberExpression") &&
      !test.computed &&
      !test.optional &&
      getStaticMemberPropertyName(test) === "aborted" &&
      isNodeOfType(test.object, "MemberExpression") &&
      !test.object.computed &&
      !test.object.optional &&
      getStaticMemberPropertyName(test.object) === "signal" &&
      certifiedOccurrences.has(test.object.object)
    );
  };
  if (callback.body === settlementCall) return true;
  let onlyVoidStatements = true;
  walkAst(callback.body, (node) => {
    if (!onlyVoidStatements) return false;
    if (isNodeOfType(node, "BlockStatement")) return;
    if (isNodeOfType(node, "IfStatement") && isAbortTest(node.test)) return;
    if (isNodeOfType(node.parent, "IfStatement") && node.parent.test === node) return false;
    if (isNodeOfType(node, "ExpressionStatement") && node.expression === settlementCall)
      return false;
    if (isNodeOfType(node, "ReturnStatement") && !node.argument) return false;
    onlyVoidStatements = false;
    return false;
  });
  return onlyVoidStatements;
};

const isClosedCancellationSettler = (
  owner: EsTreeNode,
  closed: ClosedCancellationWrapper,
  scopes: ScopeAnalysis,
): boolean => {
  if (
    !isFunctionLike(owner) ||
    owner.async ||
    owner.generator ||
    owner.params.length !== 1 ||
    !isNodeOfType(owner.params[0], "Identifier") ||
    !isNodeOfType(owner.body, "BlockStatement")
  )
    return false;
  const declaration = owner.parent;
  if (
    !isNodeOfType(declaration, "VariableDeclarator") ||
    !isNodeOfType(declaration.id, "Identifier") ||
    findEnclosingFunction(declaration) !== closed.wrapper
  )
    return false;
  const binding = scopes.symbolFor(declaration.id);
  const parameter = scopes.symbolFor(owner.params[0]);
  if (
    !binding ||
    !parameter ||
    !isSymbolReadOnly(binding) ||
    getDirectConstInitializer(binding) !== owner ||
    binding.references.length === 0
  )
    return false;
  const isPrimitive = (value: EsTreeNode): boolean =>
    isNodeOfType(value, "Literal") &&
    (value.value === null ||
      typeof value.value === "boolean" ||
      typeof value.value === "string" ||
      typeof value.value === "number");
  const isOwnedScalarRef = (value: EsTreeNode): boolean => {
    if (
      !isNodeOfType(value, "MemberExpression") ||
      value.computed ||
      value.optional ||
      getStaticMemberPropertyName(value) !== "current"
    )
      return false;
    const ref = scopes.symbolFor(value.object);
    if (!ref) return false;
    const cached = closed.scalarRefProofs.get(ref);
    if (cached !== undefined) return cached;
    const initializer = isSymbolReadOnly(ref) ? getDirectConstInitializer(ref) : null;
    const proven = Boolean(
      ref !== closed.proof.ownedRef &&
      findEnclosingFunction(ref.declarationNode) === findEnclosingFunction(closed.wrapper) &&
      isNodeOfType(initializer, "CallExpression") &&
      initializer.arguments.length === 1 &&
      isReactApiCall(initializer, "useRef", scopes) &&
      isPrimitive(initializer.arguments[0]) &&
      ref.references.every(
        ({ identifier }) =>
          isNodeOfType(identifier.parent, "MemberExpression") &&
          identifier.parent.object === identifier &&
          !identifier.parent.computed &&
          !identifier.parent.optional &&
          getStaticMemberPropertyName(identifier.parent) === "current" &&
          !isNodeOfType(identifier.parent.parent, "UpdateExpression") &&
          !(
            isNodeOfType(identifier.parent.parent, "UnaryExpression") &&
            identifier.parent.parent.operator === "delete"
          ),
      ),
    );
    closed.scalarRefProofs.set(ref, proven);
    return proven;
  };
  const isParameter = (node: EsTreeNode): boolean => scopes.symbolFor(node) === parameter;
  const isControl = (node: EsTreeNode): boolean => {
    if (isParameter(node)) return true;
    return (
      isNodeOfType(node, "BinaryExpression") &&
      node.operator === "!==" &&
      isNodeOfType(node.left, "MemberExpression") &&
      !node.left.computed &&
      !node.left.optional &&
      getStaticMemberPropertyName(node.left) === "current" &&
      scopes.symbolFor(node.left.object) === closed.proof.ownedRef &&
      closed.certifiedOccurrences.has(node.right)
    );
  };
  let safeBody = true;
  walkAst(owner.body, (node) => {
    if (!safeBody) return false;
    if (isNodeOfType(node, "BlockStatement")) return;
    if (isNodeOfType(node, "IfStatement")) {
      if (!isControl(node.test)) safeBody = false;
      return;
    }
    if (isNodeOfType(node, "ReturnStatement") && !node.argument) return false;
    if (isNodeOfType(node, "ExpressionStatement")) {
      const assignment = node.expression;
      if (
        isNodeOfType(assignment, "AssignmentExpression") &&
        assignment.operator === "=" &&
        isOwnedScalarRef(assignment.left) &&
        (isPrimitive(assignment.right) ||
          (isNodeOfType(assignment.right, "ConditionalExpression") &&
            isParameter(assignment.right.test) &&
            isPrimitive(assignment.right.consequent) &&
            isPrimitive(assignment.right.alternate)))
      )
        return false;
    }
    if (isNodeOfType(node.parent, "IfStatement") && node.parent.test === node) return false;
    safeBody = false;
    return false;
  });
  return (
    safeBody &&
    binding.references.every(({ identifier }) => {
      const call = identifier.parent;
      if (
        !isNodeOfType(call, "CallExpression") ||
        call.callee !== identifier ||
        call.optional ||
        call.arguments.length !== 1 ||
        !isNodeOfType(call.arguments[0], "Literal") ||
        typeof call.arguments[0].value !== "boolean"
      )
        return false;
      const caller = findEnclosingFunction(call);
      return (
        caller === closed.wrapper ||
        Boolean(
          caller &&
          isCancellationCompletionRegistration(caller, closed, scopes) &&
          isVoidCancellationContinuation(caller, call, closed.certifiedOccurrences),
        )
      );
    })
  );
};

const isLocalCancellationRegistrationParameter = (
  reference: Reference,
  argument: EsTreeNode,
  closed: ClosedCancellationWrapper,
  scopes: ScopeAnalysis,
): boolean => {
  const registration = findTransparentExpressionRoot(argument).parent;
  return Boolean(
    reference.resolved?.defs.some((definition) => {
      if (definition.type !== "Parameter") return false;
      const owner = definition.node as unknown as EsTreeNode;
      if (owner === argument && isNodeOfType(registration, "CallExpression"))
        return closed.isRenderGuard(registration);
      if (
        argument !== closed.wrapper &&
        !isCancellationCompletionRegistration(argument, closed, scopes)
      )
        return false;
      const cached = closed.settlerProofs.get(owner);
      if (cached !== undefined) return cached;
      const proven = isClosedCancellationSettler(owner, closed, scopes);
      closed.settlerProofs.set(owner, proven);
      return proven;
    }),
  );
};

export const createCancellationRegistrationProof = (
  analysis: ProgramAnalysis,
  scopes: ScopeAnalysis,
  getSignalProof: (call: EsTreeNode) => OwnedAbortSignalCommandProof | null,
) => {
  const wrappers = new WeakMap<SymbolDescriptor, ClosedCancellationWrapper | null>();
  return (reference: Reference, call: EsTreeNodeOfType<"CallExpression">) => {
    if (call.optional || call.arguments.length > 0) return null;
    const symbol = scopes.symbolFor(call.callee);
    if (!symbol) return null;
    let closed = wrappers.get(symbol);
    if (closed === undefined) {
      closed = getClosedCancellationWrapper(analysis, reference, symbol, scopes, getSignalProof);
      wrappers.set(symbol, closed);
    }
    if (!closed) return null;
    const proven = closed;
    return (argumentReference: Reference, argument: EsTreeNode): boolean =>
      isLocalCancellationRegistrationParameter(argumentReference, argument, proven, scopes);
  };
};
