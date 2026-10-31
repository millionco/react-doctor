import { STATE_SETTER_INDEX } from "../constants/native-state-setter.js";
import type { SymbolDescriptor } from "../semantic/scope-analysis.js";
import { EFFECT_HOOK_NAMES } from "../constants/react.js";
import { componentOrHookDisplayNameForFunction } from "./component-or-hook-display-name.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getEffectCallback } from "./get-effect-callback.js";
import { getEquivalentSymbols } from "./get-equivalent-symbols.js";
import { getResolvedStaticPropertyName } from "./get-resolved-static-property-name.js";
import { getReactUseCallbackCall } from "./get-react-use-callback-call.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { getTransparentReactCallbackWrapperArgument } from "./get-transparent-react-callback-wrapper-argument.js";
import { isBindingAssignmentTarget } from "./is-binding-assignment-target.js";
import { isFiniteEffectCallbackBooleanInput } from "./is-finite-effect-callback-boolean-input.js";
import { isFunctionLike } from "./is-function-like.js";
import { isMemberMutationTarget } from "./is-member-mutation-target.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isNodeReachableWithinFunction } from "./is-node-reachable-within-function.js";
import { isProvenUnmodifiedReactApiCall } from "./is-proven-unmodified-react-api-call.js";
import { isReactHookResultReference } from "./is-react-hook-result-reference.js";
import { isSupportedUseCallbackExecutionPath } from "./is-supported-usecallback-execution-path.js";
import { resolveReactRefSymbol } from "./react-ref-origin.js";
import type { RuleContext } from "./rule-context.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";
import { walkOwnFunctionScope } from "./walk-own-function-scope.js";

export interface ProvenEffectCallResolver {
  readonly resolve: (
    call: EsTreeNodeOfType<"CallExpression">,
    context: RuleContext,
  ) => EsTreeNode[];
  readonly hasProvenStateDispatchers: (functionNode: EsTreeNode) => boolean;
}

const STATE_DISPATCHER_HOOKS: ReadonlySet<string> = new Set(["useState", "useReducer"]);
const REACHABILITY_OPTIONS = { evaluatePrimitiveLiteralTruthiness: true };

const hasOpaqueInputs = (functionNode: EsTreeNode): boolean => {
  if (!isFunctionLike(functionNode) || functionNode.params.length > 0 || functionNode.generator)
    return true;
  let opaqueInputs = false;
  walkAst(functionNode.body, (node) => {
    if (
      isNodeOfType(node, "ThisExpression") ||
      (isNodeOfType(node, "Identifier") && node.name === "arguments")
    ) {
      opaqueInputs = true;
      return false;
    }
  });
  return opaqueInputs;
};

export const createProvenEffectCallResolver = (
  effectCall: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): ProvenEffectCallResolver | null => {
  if (!isProvenUnmodifiedReactApiCall(effectCall, EFFECT_HOOK_NAMES, context.scopes)) return null;
  const effectCallback = getEffectCallback(effectCall);
  const owner = findEnclosingFunction(effectCall);
  if (
    !isFunctionLike(effectCallback) ||
    hasOpaqueInputs(effectCallback) ||
    !isFunctionLike(owner) ||
    owner.async ||
    owner.generator ||
    !componentOrHookDisplayNameForFunction(owner)
  )
    return null;

  const getReadonlyOrigin = (
    identifier: EsTreeNode,
    reference: EsTreeNode,
  ): SymbolDescriptor | null => {
    const candidate = stripParenExpression(identifier);
    if (!isNodeOfType(candidate, "Identifier")) return null;
    let symbol = context.scopes.symbolFor(candidate);
    const visited = new Set<number>();
    while (symbol) {
      if (
        visited.has(symbol.id) ||
        symbol.kind !== "const" ||
        symbol.references.some(
          (reference) =>
            reference.flag !== "read" || isBindingAssignmentTarget(reference.identifier),
        )
      )
        return null;
      visited.add(symbol.id);
      const declarator = symbol.declarationNode;
      if (
        !isNodeOfType(declarator, "VariableDeclarator") ||
        !declarator.init ||
        declarator.range[1] > reference.range[0]
      )
        return null;
      const initializer = stripParenExpression(declarator.init);
      if (declarator.id !== symbol.bindingIdentifier || !isNodeOfType(initializer, "Identifier"))
        return symbol;
      symbol = context.scopes.symbolFor(initializer);
    }
    return null;
  };

  const isNativePromiseOrigin = (expression: EsTreeNode): boolean => {
    let candidate = stripParenExpression(expression);
    const visited = new Set<number>();
    while (isNodeOfType(candidate, "Identifier")) {
      if (candidate.name === "Promise" && context.scopes.isGlobalReference(candidate)) return true;
      const symbol = context.scopes.symbolFor(candidate);
      if (
        !symbol ||
        visited.has(symbol.id) ||
        symbol.kind !== "const" ||
        !isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
        symbol.declarationNode.id !== symbol.bindingIdentifier ||
        !symbol.initializer ||
        symbol.declarationNode.range[1] > candidate.range[0] ||
        symbol.references.some(
          (reference) =>
            reference.flag !== "read" || isBindingAssignmentTarget(reference.identifier),
        )
      )
        return false;
      visited.add(symbol.id);
      candidate = stripParenExpression(symbol.initializer);
    }
    return false;
  };

  const hasNativeRejectionOrigin = (
    expression: EsTreeNode,
    visited = new Set<number>(),
  ): boolean => {
    let hasRejection = false;
    walkAst(expression, (candidate) => {
      if (hasRejection || isFunctionLike(candidate)) return false;
      if (
        isNodeOfType(candidate, "MemberExpression") &&
        getStaticPropertyName(candidate) === "reject" &&
        isNativePromiseOrigin(candidate.object)
      ) {
        hasRejection = true;
        return false;
      }
      if (!isNodeOfType(candidate, "Identifier")) return;
      const symbol = getReadonlyOrigin(candidate, candidate);
      if (!symbol?.initializer || visited.has(symbol.id)) return;
      const declaration = symbol.declarationNode;
      if (
        isNodeOfType(declaration, "VariableDeclarator") &&
        isNodeOfType(declaration.id, "ObjectPattern") &&
        declaration.init &&
        isNativePromiseOrigin(declaration.init) &&
        declaration.id.properties.some(
          (property) =>
            isNodeOfType(property, "Property") &&
            (property.value === symbol.bindingIdentifier ||
              (isNodeOfType(property.value, "AssignmentPattern") &&
                property.value.left === symbol.bindingIdentifier)) &&
            getResolvedStaticPropertyName(property, context.scopes) === "reject",
        )
      ) {
        hasRejection = true;
        return false;
      }
      visited.add(symbol.id);
      hasRejection = hasNativeRejectionOrigin(symbol.initializer, visited);
    });
    return hasRejection;
  };

  const isSupportedExecutionPredicate = (
    expression: EsTreeNode,
    visited = new Set<number>(),
  ): boolean => {
    const predicate = stripParenExpression(expression);
    if (isNodeOfType(predicate, "Literal")) return true;
    if (isNodeOfType(predicate, "UnaryExpression") && predicate.operator === "!")
      return isSupportedExecutionPredicate(predicate.argument, visited);
    if (isNodeOfType(predicate, "Identifier")) {
      if (predicate.name === "undefined" && context.scopes.isGlobalReference(predicate))
        return true;
      const symbol = context.scopes.symbolFor(predicate);
      if (!symbol || visited.has(symbol.id)) return false;
      visited.add(symbol.id);
      const readonlyBinding = symbol.references.every(
        (reference) =>
          reference.flag === "read" && !isBindingAssignmentTarget(reference.identifier),
      );
      if (symbol.kind === "parameter")
        return readonlyBinding && findEnclosingFunction(symbol.bindingIdentifier) === owner;
      if (symbol.kind === "function") return readonlyBinding;
      const declaration = symbol.declarationNode;
      const initializer = symbol.initializer ? stripParenExpression(symbol.initializer) : null;
      if (!isNodeOfType(declaration, "VariableDeclarator") || !initializer) return false;
      if (declaration.id !== symbol.bindingIdentifier) {
        if (!isNodeOfType(declaration.id, "ArrayPattern") || !readonlyBinding) return false;
        const [stateValue] = declaration.id.elements;
        if (
          stateValue !== symbol.bindingIdentifier ||
          !isNodeOfType(initializer, "CallExpression") ||
          !isProvenUnmodifiedReactApiCall(initializer, STATE_DISPATCHER_HOOKS, context.scopes)
        )
          return false;
        const [, reducerInitialValue] = initializer.arguments;
        const [stateInitialValue] = initializer.arguments;
        const initialValue = isProvenUnmodifiedReactApiCall(initializer, "useState", context.scopes)
          ? stateInitialValue
          : reducerInitialValue;
        return Boolean(
          initialValue &&
          isNodeOfType(initialValue, "Literal") &&
          typeof initialValue.value === "boolean",
        );
      }
      if (isNodeOfType(initializer, "Literal") && typeof initializer.value === "boolean") {
        return symbol.references.every((reference) => {
          if (reference.flag === "read" && !isBindingAssignmentTarget(reference.identifier))
            return true;
          const referenceRoot = findTransparentExpressionRoot(reference.identifier);
          const assignment = referenceRoot.parent;
          return (
            isNodeOfType(assignment, "AssignmentExpression") &&
            assignment.operator === "=" &&
            assignment.left === referenceRoot &&
            isNodeOfType(assignment.right, "Literal") &&
            typeof assignment.right.value === "boolean"
          );
        });
      }
      if (symbol.kind !== "const" || !readonlyBinding || declaration.range[1] > predicate.range[0])
        return false;
      if (isFunctionLike(initializer)) return true;
      if (isProvenUnmodifiedReactApiCall(initializer, "useCallback", context.scopes)) return true;
      return isSupportedExecutionPredicate(initializer, visited);
    }
    if (
      !isNodeOfType(predicate, "MemberExpression") ||
      getResolvedStaticPropertyName(predicate, context.scopes) !== "current"
    )
      return false;
    const symbol = resolveReactRefSymbol(predicate, context.scopes);
    if (
      !symbol ||
      getReadonlyOrigin(predicate.object, predicate) !== symbol ||
      !symbol.initializer ||
      findEnclosingFunction(symbol.declarationNode) !== owner ||
      !isProvenUnmodifiedReactApiCall(symbol.initializer, "useRef", context.scopes)
    )
      return false;
    const initializer = stripParenExpression(symbol.initializer);
    if (!isNodeOfType(initializer, "CallExpression")) return false;
    const [initialValue] = initializer.arguments;
    if (!isNodeOfType(initialValue, "Literal") || typeof initialValue.value !== "boolean")
      return false;
    return getEquivalentSymbols(symbol.bindingIdentifier, context.scopes).every((binding) =>
      binding.references.every((reference) => {
        const receiver = findTransparentExpressionRoot(reference.identifier);
        const member = receiver.parent;
        if (reference.flag !== "read" || isBindingAssignmentTarget(reference.identifier))
          return false;
        if (
          isNodeOfType(member, "VariableDeclarator") &&
          member.init === receiver &&
          isNodeOfType(member.id, "Identifier") &&
          isNodeOfType(member.parent, "VariableDeclaration") &&
          member.parent.kind === "const"
        )
          return true;
        if (
          !isNodeOfType(member, "MemberExpression") ||
          member.object !== receiver ||
          getResolvedStaticPropertyName(member, context.scopes) !== "current"
        )
          return false;
        const memberRoot = findTransparentExpressionRoot(member);
        const usage = memberRoot.parent;
        if (!isMemberMutationTarget(member))
          return !(isNodeOfType(usage, "CallExpression") && usage.callee === memberRoot);
        return (
          isNodeOfType(usage, "AssignmentExpression") &&
          usage.operator === "=" &&
          usage.left === memberRoot &&
          isNodeOfType(usage.right, "Literal") &&
          typeof usage.right.value === "boolean"
        );
      }),
    );
  };

  const isSupportedExecutionCondition = (expression: EsTreeNode): boolean =>
    isFiniteEffectCallbackBooleanInput(expression, context) ||
    isSupportedExecutionPredicate(expression);

  const hasExecutionBranch = (expression: EsTreeNode): boolean => {
    let hasExecution = false;
    walkAst(expression, (node) => {
      if (hasExecution || isFunctionLike(node)) return false;
      if (
        isNodeOfType(node, "AwaitExpression") ||
        (isNodeOfType(node, "CallExpression") &&
          isNodeOfType(node.callee, "Identifier") &&
          isReactHookResultReference(
            node.callee,
            STATE_DISPATCHER_HOOKS,
            STATE_SETTER_INDEX,
            context.scopes,
          ))
      )
        hasExecution = true;
    });
    return hasExecution;
  };

  const resolveCallback = (identifier: EsTreeNode, call: EsTreeNode): EsTreeNode | null => {
    const symbol = getReadonlyOrigin(identifier, call);
    if (
      !symbol ||
      !isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
      symbol.declarationNode.id !== symbol.bindingIdentifier ||
      !symbol.initializer ||
      symbol.declarationNode.range[1] > call.range[0] ||
      findEnclosingFunction(symbol.declarationNode) !== owner
    )
      return null;
    const initializer = stripParenExpression(symbol.initializer);
    let callback: EsTreeNode | null = isFunctionLike(initializer) ? initializer : null;
    if (!callback) {
      const wrapper = getReactUseCallbackCall(identifier, context.scopes);
      if (!wrapper || !isProvenUnmodifiedReactApiCall(wrapper, "useCallback", context.scopes))
        return null;
      callback = getTransparentReactCallbackWrapperArgument(wrapper, symbol, context.scopes);
      if (callback) callback = stripParenExpression(callback);
    }
    return callback && isFunctionLike(callback) && !hasOpaqueInputs(callback) ? callback : null;
  };

  const resolveRefCallback = (member: EsTreeNode, call: EsTreeNode): EsTreeNode | null => {
    if (
      !isNodeOfType(member, "MemberExpression") ||
      member.computed ||
      member.optional ||
      getStaticPropertyName(member) !== "current"
    )
      return null;
    const symbol = resolveReactRefSymbol(member, context.scopes);
    const readonlyOrigin = getReadonlyOrigin(member.object, call);
    if (
      !symbol ||
      readonlyOrigin !== symbol ||
      !symbol.initializer ||
      symbol.declarationNode.range[1] > call.range[0] ||
      findEnclosingFunction(symbol.declarationNode) !== owner ||
      !isProvenUnmodifiedReactApiCall(symbol.initializer, "useRef", context.scopes)
    )
      return null;
    const initializer = stripParenExpression(symbol.initializer);
    if (!isNodeOfType(initializer, "CallExpression")) return null;
    const callbackValue = initializer.arguments[0];
    if (!callbackValue) return null;
    const callbackSymbol = getReadonlyOrigin(callbackValue, initializer);
    const callback = resolveCallback(callbackValue, initializer);
    if (!callbackSymbol || !callback) return null;
    for (const binding of getEquivalentSymbols(symbol.bindingIdentifier, context.scopes)) {
      for (const reference of binding.references) {
        const receiver = findTransparentExpressionRoot(reference.identifier);
        const referenceMember = receiver.parent;
        if (reference.flag !== "read" || isBindingAssignmentTarget(reference.identifier))
          return null;
        if (
          isNodeOfType(referenceMember, "VariableDeclarator") &&
          referenceMember.init === receiver &&
          isNodeOfType(referenceMember.id, "Identifier") &&
          isNodeOfType(referenceMember.parent, "VariableDeclaration") &&
          referenceMember.parent.kind === "const"
        )
          continue;
        if (
          !isNodeOfType(referenceMember, "MemberExpression") ||
          referenceMember.object !== receiver ||
          referenceMember.computed ||
          referenceMember.optional ||
          getStaticPropertyName(referenceMember) !== "current"
        )
          return null;
        const referenceRoot = findTransparentExpressionRoot(referenceMember);
        const usage = referenceRoot.parent;
        if (
          isNodeOfType(usage, "CallExpression") &&
          usage.callee === referenceRoot &&
          !usage.optional &&
          usage.arguments.length === 0
        )
          continue;
        if (
          isNodeOfType(usage, "AssignmentExpression") &&
          usage.operator === "=" &&
          usage.left === referenceRoot &&
          getReadonlyOrigin(usage.right, usage) === callbackSymbol
        )
          continue;
        return null;
      }
    }
    return callback;
  };

  return {
    resolve: (call) => {
      const caller = findEnclosingFunction(call);
      if (
        call.optional ||
        call.arguments.length > 0 ||
        !caller ||
        hasOpaqueInputs(caller) ||
        !isNodeReachableWithinFunction(call, context, REACHABILITY_OPTIONS) ||
        !isSupportedUseCallbackExecutionPath(call, caller, context)
      )
        return [];
      const callee = stripParenExpression(call.callee);
      let callback: EsTreeNode | null = null;
      if (isNodeOfType(callee, "Identifier")) callback = resolveCallback(callee, call);
      else if (isNodeOfType(callee, "MemberExpression"))
        callback = resolveRefCallback(callee, call);
      else if (isFunctionLike(callee) && !hasOpaqueInputs(callee)) callback = callee;
      return callback ? [callback] : [];
    },
    hasProvenStateDispatchers: (functionNode) => {
      let hasDispatcher = false;
      let isProven = true;
      walkOwnFunctionScope(functionNode, (node) => {
        if (isNodeOfType(node, "IfStatement") && !isSupportedExecutionCondition(node.test))
          isProven = false;
        if (
          isNodeOfType(node, "ConditionalExpression") &&
          (hasExecutionBranch(node.consequent) || hasExecutionBranch(node.alternate)) &&
          !isSupportedExecutionCondition(node.test)
        )
          isProven = false;
        if (
          isNodeOfType(node, "LogicalExpression") &&
          hasExecutionBranch(node.right) &&
          !isSupportedExecutionCondition(node.left)
        )
          isProven = false;
        if (isNodeOfType(node, "AwaitExpression") && hasNativeRejectionOrigin(node.argument))
          isProven = false;

        if (
          isNodeOfType(node, "AwaitExpression") &&
          (!isNodeReachableWithinFunction(node, context, REACHABILITY_OPTIONS) ||
            !isSupportedUseCallbackExecutionPath(node, functionNode, context))
        )
          isProven = false;
        if (
          !isNodeOfType(node, "CallExpression") ||
          !isNodeOfType(node.callee, "Identifier") ||
          !isReactHookResultReference(
            node.callee,
            STATE_DISPATCHER_HOOKS,
            STATE_SETTER_INDEX,
            context.scopes,
          )
        )
          return;
        hasDispatcher = true;
        const symbol = getReadonlyOrigin(node.callee, node);
        const declaration = symbol?.declarationNode;
        if (
          !isNodeOfType(declaration, "VariableDeclarator") ||
          !declaration.init ||
          findEnclosingFunction(declaration) !== owner ||
          !isProvenUnmodifiedReactApiCall(
            declaration.init,
            STATE_DISPATCHER_HOOKS,
            context.scopes,
          ) ||
          !isNodeReachableWithinFunction(node, context, REACHABILITY_OPTIONS) ||
          !isSupportedUseCallbackExecutionPath(node, functionNode, context)
        )
          isProven = false;
      });
      return hasDispatcher && isProven;
    },
  };
};
