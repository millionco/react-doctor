import { EFFECT_HOOK_NAMES } from "../constants/react.js";
import {
  FIRST_ARGUMENT_INDEX,
  SECOND_ARGUMENT_INDEX,
} from "../rules/state-and-effects/utils/effect/constants.js";
import {
  EFFECT_GENERATION_COUNTER_INITIAL_VALUE,
  EFFECT_REF_INITIALIZER_ARGUMENT_COUNT,
  EFFECT_CALLBACK_HOLDER_DEPENDENCY_COUNT,
} from "../rules/state-and-effects/utils/constants.js";
import type { SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { collectFunctionReturnStatements } from "./collect-function-return-statements.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getDirectConstInitializer } from "./get-direct-const-initializer.js";
import { getGlobalRequireModuleSource } from "./get-global-require-module-source.js";
import { getImportedName } from "./get-imported-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { hasReactDefaultProviderMutation } from "./has-react-default-provider-mutation.js";
import { isBindingAssignmentTarget } from "./is-binding-assignment-target.js";
import { hasRuntimeValueBinding } from "./has-runtime-value-binding.js";
import { isErasedTypeScriptBinding } from "./is-erased-typescript-binding.js";
import { isFunctionLike } from "./is-function-like.js";
import { isMemberMutationTarget } from "./is-member-mutation-target.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isNodeOnUnconditionalPath } from "./is-node-on-unconditional-path.js";
import { isNodeReachableWithinFunction } from "./is-node-reachable-within-function.js";
import { isNonEscapingReactApiReference } from "./is-non-escaping-react-api-reference.js";
import { nodeDominatesNode } from "./node-dominates-node.js";
import type { RuleContext } from "./rule-context.js";
import { serializeReferenceKey } from "./serialize-reference-key.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";
import { walkOwnFunctionScope } from "./walk-own-function-scope.js";

interface RefReadSequenceInput {
  asyncFunction: EsTreeNode;
  effectCallback: EsTreeNode;
  context: RuleContext;
}

const isReadonlyBinding = (symbol: SymbolDescriptor): boolean =>
  symbol.references.every(
    (reference) => reference.flag === "read" && !isBindingAssignmentTarget(reference.identifier),
  );

const isNativeNamedCall = (
  node: EsTreeNode,
  names: ReadonlySet<string>,
  context: RuleContext,
): boolean => {
  if (!isNodeOfType(node, "CallExpression") || node.optional) return false;
  const callee = stripParenExpression(node.callee);
  if (!isNodeOfType(callee, "Identifier")) return false;
  const symbol = context.scopes.symbolFor(callee);
  if (!symbol || symbol.kind !== "import" || !isReadonlyBinding(symbol)) return false;
  const specifier = symbol.declarationNode;
  const declaration = specifier.parent;
  const importedName = getImportedName(specifier);
  return Boolean(
    importedName &&
    names.has(importedName) &&
    isNodeOfType(declaration, "ImportDeclaration") &&
    declaration.source.value === "react" &&
    declaration.importKind !== "type" &&
    isNodeOfType(specifier, "ImportSpecifier") &&
    specifier.importKind !== "type" &&
    !hasReactDefaultProviderMutation(importedName, context.scopes) &&
    symbol.references.every((reference) => isNonEscapingReactApiReference(reference.identifier)),
  );
};

const NATIVE_REF_NAMES = new Set(["useRef"]);

const getNativeRefInitializer = (
  symbol: SymbolDescriptor,
  context: RuleContext,
): EsTreeNode | null => {
  const initializer = getDirectConstInitializer(symbol);
  return initializer &&
    isReadonlyBinding(symbol) &&
    isNativeNamedCall(initializer, NATIVE_REF_NAMES, context)
    ? initializer
    : null;
};

const getNativeEffectCall = (callback: EsTreeNode, context: RuleContext): EsTreeNode | null => {
  const callbackRoot = findTransparentExpressionRoot(callback);
  const call = callbackRoot.parent;
  return isNodeOfType(call, "CallExpression") &&
    call.arguments[FIRST_ARGUMENT_INDEX] === callbackRoot &&
    isNativeNamedCall(call, EFFECT_HOOK_NAMES, context)
    ? call
    : null;
};

const hasOpaqueFunctionInputs = (functionNode: EsTreeNode): boolean => {
  if (
    !isFunctionLike(functionNode) ||
    functionNode.params.length ||
    functionNode.id ||
    functionNode.generator
  )
    return true;
  let hasOpaqueInputs = false;
  walkAst(functionNode.body, (node) => {
    if (
      isNodeOfType(node, "ThisExpression") ||
      (isNodeOfType(node, "Identifier") && node.name === "arguments")
    )
      hasOpaqueInputs = true;
  });
  return hasOpaqueInputs;
};

const collectStorageReferences = (
  callbackSymbol: SymbolDescriptor,
  reference: EsTreeNode,
  owner: EsTreeNode,
  context: RuleContext,
): Set<EsTreeNode> | null => {
  const referenceRoot = findTransparentExpressionRoot(reference);
  const initializer = referenceRoot.parent;
  if (
    !isNodeOfType(initializer, "CallExpression") ||
    !isNativeNamedCall(initializer, NATIVE_REF_NAMES, context) ||
    initializer.arguments.length !== EFFECT_REF_INITIALIZER_ARGUMENT_COUNT ||
    initializer.arguments[FIRST_ARGUMENT_INDEX] !== referenceRoot
  )
    return null;
  const ownerReturns = collectFunctionReturnStatements(owner);
  if (
    !isNodeOnUnconditionalPath(initializer, owner) ||
    !ownerReturns.every((returnStatement) =>
      nodeDominatesNode(initializer, returnStatement, context),
    )
  )
    return null;
  const initializerRoot = findTransparentExpressionRoot(initializer);
  const declaration = initializerRoot.parent;
  if (
    !isNodeOfType(declaration, "VariableDeclarator") ||
    declaration.init !== initializerRoot ||
    !isNodeOfType(declaration.id, "Identifier") ||
    findEnclosingFunction(declaration) !== owner
  )
    return null;
  const holder = context.scopes.symbolFor(declaration.id);
  if (!holder || getNativeRefInitializer(holder, context) !== initializer) return null;
  const acceptedReferences = new Set<EsTreeNode>([reference]);
  for (const holderReference of holder.references) {
    const holderRoot = findTransparentExpressionRoot(holderReference.identifier);
    const member = holderRoot.parent;
    if (
      !isNodeOfType(member, "MemberExpression") ||
      member.object !== holderRoot ||
      member.optional ||
      getStaticPropertyName(member) !== "current"
    )
      return null;
    const memberRoot = findTransparentExpressionRoot(member);
    const assignment = memberRoot.parent;
    if (
      !isNodeOfType(assignment, "AssignmentExpression") ||
      assignment.operator !== "=" ||
      assignment.left !== memberRoot
    )
      return null;
    const storedValue = stripParenExpression(assignment.right);
    if (
      !isNodeOfType(storedValue, "Identifier") ||
      context.scopes.symbolFor(storedValue) !== callbackSymbol
    )
      return null;
    const storageEffect = findEnclosingFunction(assignment);
    if (
      !storageEffect ||
      !isFunctionLike(storageEffect) ||
      storageEffect.async ||
      findEnclosingFunction(storageEffect) !== owner ||
      !isNodeOnUnconditionalPath(assignment, storageEffect)
    )
      return null;
    const effectCall = getNativeEffectCall(storageEffect, context);
    if (
      !isNodeOfType(effectCall, "CallExpression") ||
      !isNodeOnUnconditionalPath(effectCall, owner) ||
      !ownerReturns.every((returnStatement) =>
        nodeDominatesNode(effectCall, returnStatement, context),
      )
    )
      return null;
    const dependencies = effectCall.arguments[SECOND_ARGUMENT_INDEX];
    if (
      !isNodeOfType(dependencies, "ArrayExpression") ||
      dependencies.elements.length !== EFFECT_CALLBACK_HOLDER_DEPENDENCY_COUNT
    )
      return null;
    const dependency = dependencies.elements[FIRST_ARGUMENT_INDEX];
    if (
      !isNodeOfType(dependency, "Identifier") ||
      context.scopes.symbolFor(dependency) !== callbackSymbol
    )
      return null;
    acceptedReferences.add(storedValue);
    acceptedReferences.add(dependency);
  }
  return acceptedReferences;
};

const collectCoveredCalls = (
  asyncFunction: EsTreeNode,
  effectCallback: EsTreeNode,
  context: RuleContext,
): EsTreeNode[] | null => {
  if (hasOpaqueFunctionInputs(asyncFunction)) return null;
  const functionRoot = findTransparentExpressionRoot(asyncFunction);
  const parent = functionRoot.parent;
  if (isNodeOfType(parent, "CallExpression") && parent.callee === functionRoot) {
    return !parent.optional &&
      !parent.arguments.length &&
      findEnclosingFunction(parent) === effectCallback &&
      isNodeReachableWithinFunction(parent, context)
      ? [parent]
      : null;
  }
  if (
    !isNodeOfType(parent, "VariableDeclarator") ||
    parent.init !== functionRoot ||
    !isNodeOfType(parent.id, "Identifier")
  )
    return null;
  const owner = findEnclosingFunction(effectCallback);
  const declarationOwner = findEnclosingFunction(parent);
  const isEffectLocalDeclaration = declarationOwner === effectCallback;
  if (!owner || (declarationOwner !== owner && !isEffectLocalDeclaration)) return null;
  const symbol = context.scopes.symbolFor(parent.id);
  if (!symbol || getDirectConstInitializer(symbol) !== functionRoot || !isReadonlyBinding(symbol))
    return null;
  const storageReferences = new Set<EsTreeNode>();
  if (!isEffectLocalDeclaration) {
    for (const reference of symbol.references) {
      const storage = collectStorageReferences(symbol, reference.identifier, owner, context);
      if (storage) for (const accepted of storage) storageReferences.add(accepted);
    }
  }
  const calls: EsTreeNode[] = [];
  for (const reference of symbol.references) {
    if (storageReferences.has(reference.identifier)) continue;
    const referenceRoot = findTransparentExpressionRoot(reference.identifier);
    const call = referenceRoot.parent;
    if (
      !isNodeOfType(call, "CallExpression") ||
      call.callee !== referenceRoot ||
      call.optional ||
      call.arguments.length ||
      findEnclosingFunction(call) !== effectCallback ||
      !isNodeReachableWithinFunction(call, context) ||
      (isEffectLocalDeclaration && !nodeDominatesNode(parent, call, context))
    )
      return null;
    calls.push(call);
  }
  return calls.length ? calls : null;
};

export const collectProvenRefReadSequenceSnapshots = ({
  asyncFunction,
  effectCallback,
  context,
}: RefReadSequenceInput): Map<string, string> => {
  const snapshots = new Map<string, string>();
  const owner = findEnclosingFunction(effectCallback);
  if (
    !isFunctionLike(owner) ||
    !isFunctionLike(effectCallback) ||
    effectCallback.async ||
    effectCallback.generator ||
    !isNodeOfType(effectCallback.body, "BlockStatement") ||
    owner.async ||
    owner.generator
  )
    return snapshots;
  const effectCall = getNativeEffectCall(effectCallback, context);
  const ownerReturns = collectFunctionReturnStatements(owner);
  if (
    !effectCall ||
    !isNodeOnUnconditionalPath(effectCall, owner) ||
    !ownerReturns.every((returnStatement) =>
      nodeDominatesNode(effectCall, returnStatement, context),
    )
  )
    return snapshots;
  const firstStatement = effectCallback.body.body[FIRST_ARGUMENT_INDEX];
  const prefixIncrement = isNodeOfType(firstStatement, "ExpressionStatement")
    ? stripParenExpression(firstStatement.expression)
    : null;
  if (!isNodeOfType(prefixIncrement, "UpdateExpression") || prefixIncrement.operator !== "++")
    return snapshots;
  const calls = collectCoveredCalls(asyncFunction, effectCallback, context);
  if (!calls) return snapshots;
  let program: EsTreeNode = effectCallback;
  while (program.parent) program = program.parent;
  let hasEvalOrReactRequire = false;
  walkAst(program, (node) => {
    if (isNodeOfType(node, "Identifier") && node.name === "require") {
      const binding = context.scopes.symbolFor(node);
      if (
        binding &&
        context.scopes.referenceFor(node) &&
        isErasedTypeScriptBinding(binding) &&
        !hasRuntimeValueBinding(binding)
      ) {
        hasEvalOrReactRequire = true;
        return false;
      }
    }
    if (!isNodeOfType(node, "CallExpression")) return;
    if (
      (isNodeOfType(node.callee, "Identifier") && node.callee.name === "eval") ||
      getGlobalRequireModuleSource(node, context.scopes) === "react"
    )
      hasEvalOrReactRequire = true;
  });
  if (hasEvalOrReactRequire) return snapshots;
  const suspensions: EsTreeNode[] = [];
  walkOwnFunctionScope(asyncFunction, (node) => {
    if (
      isNodeOfType(node, "AwaitExpression") ||
      (isNodeOfType(node, "ForOfStatement") && node.await)
    )
      suspensions.push(node);
  });
  if (!suspensions.length) return snapshots;
  walkOwnFunctionScope(asyncFunction, (declaration) => {
    if (
      !isNodeOfType(declaration, "VariableDeclarator") ||
      !isNodeOfType(declaration.id, "Identifier") ||
      !declaration.init
    )
      return;
    const initializer = stripParenExpression(declaration.init);
    if (
      !isNodeOfType(initializer, "MemberExpression") ||
      initializer.optional ||
      getStaticPropertyName(initializer) !== "current" ||
      !isNodeOfType(initializer.object, "Identifier")
    )
      return;
    const snapshot = context.scopes.symbolFor(declaration.id);
    const counter = context.scopes.symbolFor(initializer.object);
    if (
      !snapshot ||
      !counter ||
      getDirectConstInitializer(snapshot) !== declaration.init ||
      !isReadonlyBinding(snapshot) ||
      !isNodeOnUnconditionalPath(declaration, asyncFunction) ||
      !suspensions.every((suspension) => nodeDominatesNode(declaration, suspension, context))
    )
      return;
    const counterInitializer = getNativeRefInitializer(counter, context);
    if (
      !isNodeOfType(counterInitializer, "CallExpression") ||
      counterInitializer.arguments.length !== EFFECT_REF_INITIALIZER_ARGUMENT_COUNT ||
      !isNodeOfType(counterInitializer.arguments[FIRST_ARGUMENT_INDEX], "Literal") ||
      counterInitializer.arguments[FIRST_ARGUMENT_INDEX].value !==
        EFFECT_GENERATION_COUNTER_INITIAL_VALUE ||
      findEnclosingFunction(counter.declarationNode) !== owner ||
      !isNodeOnUnconditionalPath(counterInitializer, owner) ||
      !ownerReturns.every((returnStatement) =>
        nodeDominatesNode(counterInitializer, returnStatement, context),
      )
    )
      return;
    const increments: EsTreeNode[] = [];
    for (const reference of counter.references) {
      const referenceRoot = findTransparentExpressionRoot(reference.identifier);
      const member = referenceRoot.parent;
      if (
        !isNodeOfType(member, "MemberExpression") ||
        member.object !== referenceRoot ||
        member.optional ||
        getStaticPropertyName(member) !== "current"
      )
        return;
      if (!isMemberMutationTarget(member)) continue;
      const update = findTransparentExpressionRoot(member).parent;
      if (
        !isNodeOfType(update, "UpdateExpression") ||
        update.operator !== "++" ||
        findEnclosingFunction(update) !== effectCallback ||
        !isNodeOnUnconditionalPath(update, effectCallback) ||
        !calls.every((call) => nodeDominatesNode(update, call, context))
      )
        return;
      increments.push(update);
    }
    if (!increments.includes(prefixIncrement)) return;
    const snapshotKey = serializeReferenceKey({ node: declaration.id, scopes: context.scopes });
    const counterKey = serializeReferenceKey({ node: initializer, scopes: context.scopes });
    if (snapshotKey && counterKey) snapshots.set(snapshotKey, counterKey);
  });
  return snapshots;
};
