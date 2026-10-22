import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { isClosedNativeMediaRefSnapshot } from "./is-closed-native-media-ref-snapshot.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getEquivalentSymbols } from "../../../utils/get-equivalent-symbols.js";
import { getImportDeclarationForSymbol } from "../../../utils/get-import-declaration-for-symbol.js";
import { getRootIdentifier } from "../../../utils/get-root-identifier.js";
import { getResolvedStaticPropertyName } from "../../../utils/get-resolved-static-property-name.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { getUninterruptedConstInitializer } from "../../../utils/get-uninterrupted-const-initializer.js";
import { hasReactDefaultProviderMutation } from "../../../utils/has-react-default-provider-mutation.js";
import { isBindingAssignmentTarget } from "../../../utils/is-binding-assignment-target.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isMemberMutationTarget } from "../../../utils/is-member-mutation-target.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import {
  isProvenGlobalNamespaceReference,
  isProvenGlobalObjectReference,
} from "../../../utils/is-proven-global-namespace-reference.js";
import { isReactApiCall } from "../../../utils/is-react-api-call.js";
import { isProvenUnmodifiedReactApiCall } from "../../../utils/is-proven-unmodified-react-api-call.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { isUnmodifiedLocalReactStateCall } from "../../../utils/is-unmodified-local-react-state-call.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import {
  FIRST_ARGUMENT_INDEX,
  NATIVE_MEDIA_CALL_ARGUMENT_COUNT,
  NATIVE_MEDIA_EFFECT_PARAMETER_COUNT,
  NATIVE_MEDIA_ELEMENT_NAMES,
  NATIVE_MEDIA_PROVIDER_NAMES,
  NATIVE_MEDIA_SUPPORT_VALUES,
  NATIVE_MEDIA_STATE_TUPLE_LENGTH,
} from "./effect/constants.js";

interface NativeMediaCapabilityPredicateInput {
  context: RuleContext;
  effectNode: EsTreeNode;
  effectFunction: EsTreeNode;
  stateDeclarator: EsTreeNode;
}

interface NativeMediaCapabilityFacts {
  readonly reactEffectProviders: Map<SymbolDescriptor, boolean>;
  readonly readonlyBindings: Map<SymbolDescriptor, boolean>;
  readonly mediaCallbacks: WeakMap<EsTreeNode, boolean>;
  readonly mediaReceiverReferences: WeakMap<EsTreeNode, Map<SymbolDescriptor, boolean>>;
  hasProviderHazard?: boolean;
}

const nativeMediaFactsByScopes = new WeakMap<
  ScopeAnalysis,
  WeakMap<EsTreeNode, NativeMediaCapabilityFacts>
>();

const getNativeMediaCapabilityFacts = (context: RuleContext): NativeMediaCapabilityFacts => {
  let factsByProgram = nativeMediaFactsByScopes.get(context.scopes);
  if (!factsByProgram) {
    factsByProgram = new WeakMap();
    nativeMediaFactsByScopes.set(context.scopes, factsByProgram);
  }
  const program = context.scopes.rootScope.node;
  let facts = factsByProgram.get(program);
  if (!facts) {
    facts = {
      reactEffectProviders: new Map(),
      readonlyBindings: new Map(),
      mediaCallbacks: new WeakMap(),
      mediaReceiverReferences: new WeakMap(),
    };
    factsByProgram.set(program, facts);
  }
  return facts;
};

const hasUnmodifiedMediaReactEffect = (call: EsTreeNode, context: RuleContext): boolean => {
  if (!isNodeOfType(call, "CallExpression") || !isReactApiCall(call, "useEffect", context.scopes))
    return false;
  const identifier = getRootIdentifier(call.callee);
  const symbol = identifier ? context.scopes.symbolFor(identifier) : null;
  if (!symbol) return false;
  const facts = getNativeMediaCapabilityFacts(context);
  const cached = facts.reactEffectProviders.get(symbol);
  if (cached !== undefined) return cached;
  const proven =
    isProvenUnmodifiedReactApiCall(call, "useEffect", context.scopes) &&
    !hasReactDefaultProviderMutation("useEffect", context.scopes);
  facts.reactEffectProviders.set(symbol, proven);
  return proven;
};

const isReadonlyBinding = (symbol: SymbolDescriptor, context: RuleContext): boolean => {
  const facts = getNativeMediaCapabilityFacts(context);
  const cached = facts.readonlyBindings.get(symbol);
  if (cached !== undefined) return cached;
  const readonly =
    symbol.kind === "const" &&
    symbol.references.every(
      (reference) => reference.flag === "read" && !isBindingAssignmentTarget(reference.identifier),
    );
  facts.readonlyBindings.set(symbol, readonly);
  return readonly;
};

const hasNativeMediaCall = (callback: EsTreeNode, context: RuleContext): boolean => {
  const facts = getNativeMediaCapabilityFacts(context);
  const cached = facts.mediaCallbacks.get(callback);
  if (cached !== undefined) return cached;
  let hasMediaCall = false;
  walkAst(callback, (node) => {
    if (node !== callback && isFunctionLike(node)) return false;
    if (isOrdinaryMemberCall(node, "canPlayType")) hasMediaCall = true;
  });
  facts.mediaCallbacks.set(callback, hasMediaCall);
  return hasMediaCall;
};

const hasCanonicalReactImport = (call: EsTreeNode, context: RuleContext): boolean => {
  if (!isNodeOfType(call, "CallExpression") || call.optional) return false;
  const identifier = getRootIdentifier(call.callee);
  const symbol = identifier ? context.scopes.symbolFor(identifier) : null;
  const declaration = symbol ? getImportDeclarationForSymbol(symbol) : null;
  return Boolean(
    declaration &&
    declaration.source.value === "react" &&
    declaration.importKind !== "type" &&
    (!isNodeOfType(symbol?.declarationNode, "ImportSpecifier") ||
      symbol.declarationNode.importKind !== "type"),
  );
};

const isOrdinaryMemberCall = (node: EsTreeNode, memberName: string): boolean =>
  isNodeOfType(node, "CallExpression") &&
  !node.optional &&
  node.arguments.length === NATIVE_MEDIA_CALL_ARGUMENT_COUNT &&
  isNodeOfType(node.callee, "MemberExpression") &&
  !node.callee.optional &&
  !node.callee.computed &&
  getStaticPropertyName(node.callee) === memberName;

const isFreshMediaElement = (node: EsTreeNode, context: RuleContext): boolean => {
  if (!isOrdinaryMemberCall(node, "createElement") || !isNodeOfType(node, "CallExpression"))
    return false;
  const callee = node.callee;
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  const receiver = stripParenExpression(callee.object);
  const tag = node.arguments[FIRST_ARGUMENT_INDEX];
  return (
    isNodeOfType(receiver, "Identifier") &&
    receiver.name === "document" &&
    context.scopes.isGlobalReference(receiver) &&
    isNodeOfType(tag, "Literal") &&
    typeof tag.value === "string" &&
    NATIVE_MEDIA_ELEMENT_NAMES.has(tag.value)
  );
};

const hasNativeMediaProviderHazard = (context: RuleContext): boolean => {
  const facts = getNativeMediaCapabilityFacts(context);
  if (facts.hasProviderHazard !== undefined) return facts.hasProviderHazard;
  let hasProviderHazard = false;
  walkAst(context.scopes.rootScope.node, (node) => {
    if (hasProviderHazard) return false;
    if (isTypeScriptTypePosition(node)) return false;
    if (
      (isNodeOfType(node, "MemberExpression") && isMemberMutationTarget(node)) ||
      isProvenGlobalObjectReference(node, context.scopes) ||
      [...NATIVE_MEDIA_PROVIDER_NAMES].some((provider) =>
        isProvenGlobalNamespaceReference(node, provider, context.scopes),
      ) ||
      ((isNodeOfType(node, "MemberExpression") ||
        (isNodeOfType(node, "Property") && isNodeOfType(node.parent, "ObjectPattern"))) &&
        getResolvedStaticPropertyName(node, context.scopes) === "__proto__")
    ) {
      hasProviderHazard = true;
      return false;
    }
    if (
      !isNodeOfType(node, "Identifier") ||
      node.name !== "document" ||
      !context.scopes.isGlobalReference(node)
    )
      return;
    const member = findTransparentExpressionRoot(node).parent;
    const call = member ? findTransparentExpressionRoot(member).parent : null;
    if (
      !isNodeOfType(member, "MemberExpression") ||
      !isNodeOfType(call, "CallExpression") ||
      !isFreshMediaElement(call, context)
    )
      hasProviderHazard = true;
  });
  facts.hasProviderHazard = hasProviderHazard;
  return hasProviderHazard;
};

const hasClosedMediaReceiverReferences = (
  symbol: SymbolDescriptor,
  effectFunction: EsTreeNode,
  context: RuleContext,
): boolean => {
  const facts = getNativeMediaCapabilityFacts(context);
  let proofs = facts.mediaReceiverReferences.get(effectFunction);
  if (!proofs) {
    proofs = new Map();
    facts.mediaReceiverReferences.set(effectFunction, proofs);
  }
  const cached = proofs.get(symbol);
  if (cached !== undefined) return cached;
  const aliases = getEquivalentSymbols(symbol.bindingIdentifier, context.scopes);
  const isClosed = !aliases.some(
    (alias) =>
      !isReadonlyBinding(alias, context) ||
      alias.references.some((reference) => {
        const root = findTransparentExpressionRoot(reference.identifier);
        const parent = root.parent;
        if (findEnclosingFunction(reference.identifier) !== effectFunction) return true;
        if (
          isNodeOfType(parent, "VariableDeclarator") &&
          parent.init === root &&
          isNodeOfType(parent.id, "Identifier") &&
          isNodeOfType(parent.parent, "VariableDeclaration") &&
          parent.parent.kind === "const"
        )
          return false;
        const call = parent ? findTransparentExpressionRoot(parent).parent : null;
        return (
          !isNodeOfType(parent, "MemberExpression") ||
          parent.object !== root ||
          !call ||
          !isOrdinaryMemberCall(call, "canPlayType")
        );
      }),
  );
  for (const alias of aliases) proofs.set(alias, isClosed);
  proofs.set(symbol, isClosed);
  return isClosed;
};

export const createNativeMediaCapabilityPredicate = ({
  context,
  effectNode,
  effectFunction,
  stateDeclarator,
}: NativeMediaCapabilityPredicateInput): ((expression: EsTreeNode) => boolean) | null => {
  if (!isNodeOfType(stateDeclarator, "VariableDeclarator") || !isFunctionLike(effectFunction))
    return null;
  if (!hasNativeMediaCall(effectFunction, context)) return null;
  const stateCall = stateDeclarator.init ? stripParenExpression(stateDeclarator.init) : null;
  const effectArgument = isNodeOfType(effectNode, "CallExpression")
    ? effectNode.arguments[FIRST_ARGUMENT_INDEX]
    : null;
  if (
    !stateCall ||
    !effectArgument ||
    !hasCanonicalReactImport(stateCall, context) ||
    !isUnmodifiedLocalReactStateCall(stateCall, context.scopes) ||
    !hasCanonicalReactImport(effectNode, context) ||
    !hasUnmodifiedMediaReactEffect(effectNode, context) ||
    !isNodeOfType(effectNode, "CallExpression") ||
    stripParenExpression(effectArgument) !== effectFunction ||
    !isNodeOfType(stateDeclarator.id, "ArrayPattern") ||
    stateDeclarator.id.elements.length !== NATIVE_MEDIA_STATE_TUPLE_LENGTH ||
    effectFunction.async ||
    effectFunction.generator ||
    effectFunction.params.length !== NATIVE_MEDIA_EFFECT_PARAMETER_COUNT ||
    findEnclosingFunction(stateDeclarator) !== findEnclosingFunction(effectNode) ||
    stateDeclarator.id.elements.some((binding) => {
      if (!isNodeOfType(binding, "Identifier")) return true;
      const symbol = context.scopes.symbolFor(binding);
      return !symbol || !isReadonlyBinding(symbol, context);
    })
  )
    return null;
  if (hasNativeMediaProviderHazard(context)) return null;

  const resolveValue = (
    expression: EsTreeNode,
    isReceiver: boolean,
    visited = new Set<number>(),
  ): EsTreeNode | null => {
    const node = stripParenExpression(expression);
    if (isReceiver && isFreshMediaElement(node, context)) return node;
    if (isReceiver && isClosedNativeMediaRefSnapshot({ expression: node, effectFunction, context }))
      return node;
    if (!isReceiver && isOrdinaryMemberCall(node, "canPlayType")) {
      if (!isNodeOfType(node, "CallExpression") || !isNodeOfType(node.callee, "MemberExpression"))
        return null;
      return resolveValue(node.callee.object, true) ? node : null;
    }
    if (!isNodeOfType(node, "Identifier")) return null;
    const symbol = context.scopes.symbolFor(node);
    if (
      !symbol ||
      visited.has(symbol.id) ||
      !isReadonlyBinding(symbol, context) ||
      findEnclosingFunction(symbol.declarationNode) !== effectFunction
    )
      return null;
    const initializer = getUninterruptedConstInitializer(node, context);
    if (!initializer) return null;
    visited.add(symbol.id);
    if (isReceiver && !hasClosedMediaReceiverReferences(symbol, effectFunction, context))
      return null;
    return resolveValue(initializer, isReceiver, visited);
  };

  const comparisonValue = (expression: EsTreeNode): EsTreeNode | null => {
    const node = stripParenExpression(expression);
    if (!isNodeOfType(node, "BinaryExpression") || !["===", "!=="].includes(node.operator))
      return null;
    const literal = isNodeOfType(node.right, "Literal") ? node.right : node.left;
    const value = literal === node.right ? node.left : node.right;
    return isNodeOfType(literal, "Literal") &&
      typeof literal.value === "string" &&
      NATIVE_MEDIA_SUPPORT_VALUES.has(literal.value)
      ? resolveValue(value, false)
      : null;
  };
  const matchesPredicate = (expression: EsTreeNode): boolean => {
    const node = stripParenExpression(expression);
    if (isNodeOfType(node, "UnaryExpression") && node.operator === "!")
      return matchesPredicate(node.argument);
    if (isNodeOfType(node, "LogicalExpression") && node.operator === "||") {
      const left = stripParenExpression(node.left);
      const right = stripParenExpression(node.right);
      if (
        !isNodeOfType(left, "BinaryExpression") ||
        !isNodeOfType(right, "BinaryExpression") ||
        left.operator !== "===" ||
        right.operator !== "===" ||
        !isNodeOfType(left.right, "Literal") ||
        !isNodeOfType(right.right, "Literal") ||
        typeof left.right.value !== "string" ||
        typeof right.right.value !== "string" ||
        left.right.value === "" ||
        right.right.value === "" ||
        !NATIVE_MEDIA_SUPPORT_VALUES.has(left.right.value) ||
        !NATIVE_MEDIA_SUPPORT_VALUES.has(right.right.value) ||
        left.right.value === right.right.value
      )
        return false;
      const leftValue = comparisonValue(left);
      return Boolean(leftValue && leftValue === comparisonValue(right));
    }
    return Boolean(comparisonValue(node) || resolveValue(node, false));
  };
  const matchesClosedRefConjunction = (expression: EsTreeNode): boolean => {
    const node = stripParenExpression(expression);
    const root = findTransparentExpressionRoot(expression);
    const parent = root.parent;
    if (
      !isNodeOfType(parent, "IfStatement") ||
      parent.test !== root ||
      !isNodeOfType(node, "LogicalExpression") ||
      node.operator !== "&&"
    )
      return false;
    const guard = stripParenExpression(node.left);
    if (!isNodeOfType(guard, "Identifier")) return false;
    const guardSymbol = context.scopes.symbolFor(guard);
    const capability = comparisonValue(node.right);
    if (
      !guardSymbol ||
      !isReadonlyBinding(guardSymbol, context) ||
      !isNodeOfType(capability, "CallExpression") ||
      !isNodeOfType(capability.callee, "MemberExpression")
    )
      return false;
    const argument = capability.arguments[FIRST_ARGUMENT_INDEX];
    const value = argument ? stripParenExpression(argument) : null;
    return (
      isNodeOfType(value, "Identifier") &&
      context.scopes.symbolFor(value) === guardSymbol &&
      isClosedNativeMediaRefSnapshot({
        expression: capability.callee.object,
        effectFunction,
        context,
      })
    );
  };
  return (expression) => {
    const root = findTransparentExpressionRoot(expression);
    const parent = root.parent;
    return (
      !(
        isNodeOfType(parent, "LogicalExpression") &&
        parent.operator === "??" &&
        parent.left === root
      ) &&
      (matchesPredicate(expression) || matchesClosedRefConjunction(expression))
    );
  };
};
