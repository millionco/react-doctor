import type { FunctionCfg } from "../../semantic/control-flow-graph.js";
import {
  STATE_UPDATER_CALL_PROPERTY_WRITE_RANK,
  STATE_UPDATER_INITIAL_PROPERTY_WRITE_RANK,
  STATE_UPDATER_INVOCATION_PROPERTY_WRITE_RANK,
} from "../../constants/react.js";
import { collectConstAliasSymbols } from "../../utils/collect-const-alias-symbols.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findDeferredExecutionBoundary } from "../../utils/find-deferred-execution-boundary.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { getTransparentReactCallbackWrapperArgument } from "../../utils/get-transparent-react-callback-wrapper-argument.js";
import {
  hasPossibleStaticPropertyMutationOrEscape,
  isNodeOnUnconditionalPath,
} from "../../utils/has-static-property-write-before.js";
import { isAstDescendant } from "../../utils/is-ast-descendant.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isResultDiscardedCall } from "../../utils/is-result-discarded-call.js";
import { resolveConstIdentifierAlias } from "../../utils/resolve-const-identifier-alias.js";
import { resolveReactUseStatePair } from "../../utils/resolve-react-use-state-pair.js";
import { resolveStaticLocalCallFunction } from "../../utils/get-order-independent-local-function.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkOwnFunctionScope } from "../../utils/walk-own-function-scope.js";

const MESSAGE =
  "This side-effecting call runs inside a state updater, which React may invoke more than once. Move it outside the setter after computing the next state.";

const SYNCHRONOUS_CALLBACK_METHOD_NAMES = new Set([
  "every",
  "filter",
  "find",
  "findIndex",
  "findLast",
  "flatMap",
  "forEach",
  "map",
  "reduce",
  "reduceRight",
  "some",
  "sort",
  "toSorted",
]);
const SIDE_EFFECT_CALL_NAME_PATTERN =
  /^(?:analytics|capture|dispatch|emit|log|notify|persist|record|report|send|track)/;
const SAFE_GLOBAL_RECEIVER_NAMES = new Set(["Math", "JSON", "Object", "Array"]);
const FRESH_CONTAINER_CONSTRUCTOR_NAMES = new Set([
  "Array",
  "Map",
  "Object",
  "Set",
  "WeakMap",
  "WeakSet",
]);
const SIDE_EFFECT_METHOD_NAMES = new Set([
  "appendChild",
  "click",
  "dispatchEvent",
  "focus",
  "insertBefore",
  "remove",
  "removeChild",
  "removeItem",
  "replaceChild",
  "setItem",
]);
const GLOBAL_SCHEDULER_CALL_NAMES = new Set([
  "queueMicrotask",
  "requestAnimationFrame",
  "requestIdleCallback",
  "setImmediate",
  "setInterval",
  "setTimeout",
]);
const GLOBAL_SIDE_EFFECT_CALL_NAMES = new Set(["fetch"]);
const GLOBAL_OBJECT_RECEIVER_NAMES = new Set(["globalThis", "self", "window"]);

interface ExecutedFunctionAnalysis {
  arrayParameterSymbolIds: Set<number>;
  functions: Set<EsTreeNode>;
}

const isReactStateSetterCall = (
  node: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): boolean =>
  isNodeOfType(node.callee, "Identifier") &&
  Boolean(resolveReactUseStatePair(node.callee, context.scopes));

const stateValueIsArray = (
  setterCall: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): boolean => {
  const callee = stripParenExpression(setterCall.callee);
  if (!isNodeOfType(callee, "Identifier")) return false;
  const pair = resolveReactUseStatePair(callee, context.scopes);
  if (!pair || !isNodeOfType(pair.declarator.init, "CallExpression")) return false;
  const stateType = pair.declarator.init.typeArguments?.params[0];
  const unwrappedStateType = stateType ? stripParenExpression(stateType) : null;
  if (
    unwrappedStateType &&
    (isNodeOfType(unwrappedStateType, "TSArrayType") ||
      isNodeOfType(unwrappedStateType, "TSTupleType"))
  ) {
    return true;
  }
  if (
    unwrappedStateType &&
    isNodeOfType(unwrappedStateType, "TSTypeReference") &&
    isNodeOfType(unwrappedStateType.typeName, "Identifier") &&
    (unwrappedStateType.typeName.name === "Array" ||
      unwrappedStateType.typeName.name === "ReadonlyArray")
  ) {
    return true;
  }
  const initializerArgument = pair.declarator.init.arguments?.[0];
  if (!initializerArgument) return false;
  let initializer = stripParenExpression(initializerArgument);
  if (isFunctionLike(initializer) && !isNodeOfType(initializer.body, "BlockStatement")) {
    initializer = stripParenExpression(initializer.body);
  }
  if (isNodeOfType(initializer, "ArrayExpression")) return true;
  if (!isNodeOfType(initializer, "NewExpression")) return false;
  const constructor = stripParenExpression(initializer.callee);
  return Boolean(
    isNodeOfType(constructor, "Identifier") &&
    constructor.name === "Array" &&
    context.scopes.isGlobalReference(constructor),
  );
};

const resolveLocalFunction = (expression: EsTreeNode, context: RuleContext): EsTreeNode | null => {
  let current = stripParenExpression(expression);
  const visitedSymbolIds = new Set<number>();
  while (isNodeOfType(current, "Identifier")) {
    const symbol = context.scopes.symbolFor(current);
    if (
      !symbol ||
      visitedSymbolIds.has(symbol.id) ||
      !symbol.initializer ||
      symbol.references.some((reference) => reference.flag !== "read") ||
      (symbol.kind !== "const" && symbol.kind !== "function")
    ) {
      return null;
    }
    visitedSymbolIds.add(symbol.id);
    const initializer = stripParenExpression(symbol.initializer);
    const callbackArgument = getTransparentReactCallbackWrapperArgument(
      initializer,
      symbol,
      context.scopes,
    );
    current = stripParenExpression(callbackArgument ?? initializer);
  }
  if (isNodeOfType(current, "MemberExpression")) {
    const methodName = getStaticPropertyName(current);
    const receiver = stripParenExpression(current.object);
    if (!methodName || !isNodeOfType(receiver, "Identifier")) return null;
    const receiverSymbol = context.scopes.symbolFor(receiver);
    if (hasPossibleStaticPropertyMutationOrEscape(receiver, methodName, context.scopes)) {
      return null;
    }
    const initializer = receiverSymbol?.initializer
      ? stripParenExpression(receiverSymbol.initializer)
      : null;
    if (!isNodeOfType(initializer, "ObjectExpression")) return null;
    for (const property of initializer.properties.toReversed()) {
      if (!isNodeOfType(property, "Property") || property.kind !== "init") return null;
      const propertyName = getStaticPropertyKeyName(property, { allowComputedString: true });
      if (propertyName === null) return null;
      if (propertyName !== methodName) continue;
      const value = stripParenExpression(property.value);
      return isFunctionLike(value) ? value : null;
    }
    return null;
  }
  return isFunctionLike(current) ? current : null;
};

const resolveEffectiveDirectObjectMethodValue = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
  invocationReferenceNode: EsTreeNode,
  context: RuleContext,
): EsTreeNode | null => {
  const callee = stripParenExpression(callExpression.callee);
  if (!isNodeOfType(callee, "MemberExpression")) return null;
  const propertyName = getStaticPropertyName(callee);
  const receiver = stripParenExpression(callee.object);
  if (!propertyName || !isNodeOfType(receiver, "Identifier")) return null;
  const rootReceiverSymbol = resolveConstIdentifierAlias(receiver, context.scopes);
  const initializer = rootReceiverSymbol?.initializer
    ? stripParenExpression(rootReceiverSymbol.initializer)
    : null;
  if (
    !rootReceiverSymbol ||
    rootReceiverSymbol.kind !== "const" ||
    !isNodeOfType(initializer, "ObjectExpression")
  ) {
    return null;
  }
  let effectiveValue: EsTreeNode | null = null;
  for (const property of initializer.properties) {
    if (!isNodeOfType(property, "Property") || property.kind !== "init") return null;
    const candidatePropertyName = getStaticPropertyKeyName(property, {
      allowComputedString: true,
    });
    if (candidatePropertyName === null) return null;
    if (candidatePropertyName === propertyName) effectiveValue = property.value;
  }
  if (!effectiveValue) return null;
  const callBoundary = findDeferredExecutionBoundary(callExpression);
  const invocationBoundary = findDeferredExecutionBoundary(invocationReferenceNode);
  let effectiveWriteRank = STATE_UPDATER_INITIAL_PROPERTY_WRITE_RANK;
  let effectiveWriteOffset = initializer.range[0];
  const receiverReferences = collectConstAliasSymbols(rootReceiverSymbol, context.scopes).flatMap(
    (receiverSymbol) => receiverSymbol.references,
  );
  for (const reference of receiverReferences) {
    const identifierRoot = findTransparentExpressionRoot(reference.identifier);
    const referenceParent = identifierRoot.parent;
    if (
      isNodeOfType(referenceParent, "VariableDeclarator") &&
      referenceParent.init === identifierRoot &&
      isNodeOfType(referenceParent.id, "Identifier") &&
      context.scopes.symbolFor(referenceParent.id)?.kind === "const"
    ) {
      continue;
    }
    const memberExpression = referenceParent;
    if (
      !memberExpression ||
      !isNodeOfType(memberExpression, "MemberExpression") ||
      memberExpression.object !== identifierRoot
    ) {
      return null;
    }
    const memberPropertyName = getStaticPropertyName(memberExpression);
    if (memberPropertyName === null) return null;
    const memberRoot = findTransparentExpressionRoot(memberExpression);
    const memberParent = memberRoot.parent;
    if (
      !memberParent ||
      !isNodeOfType(memberParent, "AssignmentExpression") ||
      memberParent.left !== memberRoot
    ) {
      if (
        memberParent &&
        ((isNodeOfType(memberParent, "UpdateExpression") && memberParent.argument === memberRoot) ||
          (isNodeOfType(memberParent, "UnaryExpression") &&
            memberParent.operator === "delete" &&
            memberParent.argument === memberRoot))
      ) {
        return null;
      }
      continue;
    }
    if (memberPropertyName !== propertyName) continue;
    if (memberParent.operator !== "=") return null;
    const writeBoundary = findDeferredExecutionBoundary(memberParent);
    if (!writeBoundary) return null;
    let writeRank = STATE_UPDATER_INITIAL_PROPERTY_WRITE_RANK;
    if (writeBoundary === callBoundary) {
      if (memberParent.range[0] >= callExpression.range[0]) continue;
      writeRank = STATE_UPDATER_CALL_PROPERTY_WRITE_RANK;
    } else if (
      writeBoundary === invocationBoundary &&
      memberParent.range[0] < invocationReferenceNode.range[0]
    ) {
      writeRank = STATE_UPDATER_INVOCATION_PROPERTY_WRITE_RANK;
    } else {
      return null;
    }
    if (!isNodeOnUnconditionalPath(memberParent, writeBoundary)) return null;
    if (writeRank < effectiveWriteRank) continue;
    if (writeRank === effectiveWriteRank && memberParent.range[0] <= effectiveWriteOffset) continue;
    effectiveValue = memberParent.right;
    effectiveWriteRank = writeRank;
    effectiveWriteOffset = memberParent.range[0];
  }
  return effectiveValue;
};

const resolveCalledLocalFunction = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
  invocationReferenceNode: EsTreeNode = callExpression,
): EsTreeNode | null => {
  const exactFunction = resolveStaticLocalCallFunction(callExpression, context.scopes);
  if (exactFunction) return exactFunction;
  const effectiveObjectMethodValue = resolveEffectiveDirectObjectMethodValue(
    callExpression,
    invocationReferenceNode,
    context,
  );
  if (effectiveObjectMethodValue) {
    return resolveLocalFunction(effectiveObjectMethodValue, context);
  }
  const callee = stripParenExpression(callExpression.callee);
  if (isNodeOfType(callee, "MemberExpression")) {
    const methodName = getStaticPropertyName(callee);
    const receiver = stripParenExpression(callee.object);
    if (
      methodName === "apply" &&
      isNodeOfType(receiver, "Identifier") &&
      receiver.name === "Reflect" &&
      context.scopes.isGlobalReference(receiver)
    ) {
      const functionArgument = callExpression.arguments?.[0];
      return functionArgument && !isNodeOfType(functionArgument, "SpreadElement")
        ? resolveLocalFunction(functionArgument, context)
        : null;
    }
    if (methodName === "call" || methodName === "apply") {
      if (
        isNodeOfType(receiver, "Identifier") &&
        hasPossibleStaticPropertyMutationOrEscape(receiver, methodName, context.scopes)
      ) {
        return null;
      }
      return resolveLocalFunction(receiver, context);
    }
    return null;
  }
  return resolveLocalFunction(callee, context);
};

const functionParameterIsArray = (
  functionNode: EsTreeNode,
  identifier: EsTreeNodeOfType<"Identifier">,
  context: RuleContext,
): boolean => {
  if (!isFunctionLike(functionNode)) return false;
  const identifierSymbol = context.scopes.symbolFor(identifier);
  if (!identifierSymbol) return false;
  return functionNode.params.some((parameter) => {
    const binding = isNodeOfType(parameter, "AssignmentPattern") ? parameter.left : parameter;
    if (
      !isNodeOfType(binding, "Identifier") ||
      context.scopes.symbolFor(binding)?.id !== identifierSymbol.id
    ) {
      return false;
    }
    const annotation = binding.typeAnnotation?.typeAnnotation;
    if (!annotation) return false;
    if (isNodeOfType(annotation, "TSArrayType") || isNodeOfType(annotation, "TSTupleType")) {
      return true;
    }
    return Boolean(
      isNodeOfType(annotation, "TSTypeReference") &&
      isNodeOfType(annotation.typeName, "Identifier") &&
      (annotation.typeName.name === "Array" || annotation.typeName.name === "ReadonlyArray"),
    );
  });
};

const collectFunctionReturnValues = (functionNode: EsTreeNode): EsTreeNode[] | null => {
  if (!isFunctionLike(functionNode)) return null;
  if (!isNodeOfType(functionNode.body, "BlockStatement")) {
    return [functionNode.body];
  }
  const returnValues: EsTreeNode[] = [];
  let hasUnprovenReturn = false;
  walkOwnFunctionScope(functionNode, (child: EsTreeNode) => {
    if (!isNodeOfType(child, "ReturnStatement")) return;
    if (!child.argument) {
      hasUnprovenReturn = true;
      return;
    }
    returnValues.push(child.argument);
  });
  return !hasUnprovenReturn && returnValues.length > 0 ? returnValues : null;
};

const functionReturnsOnlyFreshContainerLiterals = (functionNode: EsTreeNode): boolean => {
  const returnValues = collectFunctionReturnValues(functionNode);
  return Boolean(
    returnValues?.every((returnValue) => {
      const candidate = stripParenExpression(returnValue);
      return (
        isNodeOfType(candidate, "ArrayExpression") || isNodeOfType(candidate, "ObjectExpression")
      );
    }),
  );
};

const functionReturnsFreshArrayWithFreshElements = (
  functionNode: EsTreeNode,
  context: RuleContext,
): boolean => {
  const returnValues = collectFunctionReturnValues(functionNode);
  return Boolean(
    returnValues?.every((returnValue) => {
      const callExpression = stripParenExpression(returnValue);
      if (!isNodeOfType(callExpression, "CallExpression")) return false;
      const callee = stripParenExpression(callExpression.callee);
      if (!isNodeOfType(callee, "MemberExpression") || getStaticPropertyName(callee) !== "map") {
        return false;
      }
      const receiver = stripParenExpression(callee.object);
      if (
        !isNodeOfType(receiver, "Identifier") ||
        !functionParameterIsArray(functionNode, receiver, context)
      ) {
        return false;
      }
      const callbackArgument = callExpression.arguments?.[0];
      if (!callbackArgument || isNodeOfType(callbackArgument, "SpreadElement")) return false;
      const callbackFunction = resolveLocalFunction(callbackArgument, context);
      return Boolean(
        callbackFunction && functionReturnsOnlyFreshContainerLiterals(callbackFunction),
      );
    }),
  );
};

const identifierIsFreshMappedArrayResult = (
  identifier: EsTreeNodeOfType<"Identifier">,
  executedFunctions: ReadonlySet<EsTreeNode>,
  context: RuleContext,
  visitedSymbolIds: Set<number> = new Set(),
): boolean => {
  const symbol = context.scopes.symbolFor(identifier);
  if (
    !symbol ||
    (symbol.kind !== "const" && symbol.kind !== "let") ||
    !symbol.initializer ||
    visitedSymbolIds.has(symbol.id) ||
    symbol.references.some((reference) => reference.flag !== "read")
  ) {
    return false;
  }
  visitedSymbolIds.add(symbol.id);
  const isDeclaredInsideUpdater = [...executedFunctions].some((functionNode) =>
    isAstDescendant(symbol.bindingIdentifier, functionNode),
  );
  if (!isDeclaredInsideUpdater) return false;
  const initializer = stripParenExpression(symbol.initializer);
  if (isNodeOfType(initializer, "Identifier")) {
    return identifierIsFreshMappedArrayResult(
      initializer,
      executedFunctions,
      context,
      visitedSymbolIds,
    );
  }
  if (!isNodeOfType(initializer, "CallExpression")) return false;
  const calledFunction = resolveCalledLocalFunction(initializer, context);
  return Boolean(
    calledFunction && functionReturnsFreshArrayWithFreshElements(calledFunction, context),
  );
};

const baseReceiverIdentifier = (expression: EsTreeNode): EsTreeNodeOfType<"Identifier"> | null => {
  let current = stripParenExpression(expression);
  while (isNodeOfType(current, "MemberExpression")) {
    current = stripParenExpression(current.object);
  }
  return isNodeOfType(current, "Identifier") ? current : null;
};

const memberReceiverIsUpdaterLocal = (
  receiver: EsTreeNodeOfType<"MemberExpression">,
  updaterFunction: EsTreeNode,
  executedFunctions: ReadonlySet<EsTreeNode>,
  context: RuleContext,
  visitedSymbolIds: Set<number>,
): boolean => {
  const propertyName = getStaticPropertyName(receiver);
  const object = stripParenExpression(receiver.object);
  if (
    receiver.computed &&
    isNodeOfType(object, "Identifier") &&
    identifierIsFreshMappedArrayResult(object, executedFunctions, context)
  ) {
    return true;
  }
  if (!propertyName || !isNodeOfType(object, "Identifier")) return false;
  const objectSymbol = context.scopes.symbolFor(object);
  if (!objectSymbol || visitedSymbolIds.has(objectSymbol.id)) return false;
  const initializer = objectSymbol.initializer
    ? stripParenExpression(objectSymbol.initializer)
    : null;
  if (!isNodeOfType(initializer, "ObjectExpression")) return false;
  for (const property of initializer.properties.toReversed()) {
    if (
      !isNodeOfType(property, "Property") ||
      getStaticPropertyKeyName(property, { allowComputedString: true }) !== propertyName
    ) {
      continue;
    }
    const value = stripParenExpression(property.value);
    if (
      isNodeOfType(value, "NewExpression") ||
      isNodeOfType(value, "ObjectExpression") ||
      isNodeOfType(value, "ArrayExpression")
    ) {
      return true;
    }
    if (isNodeOfType(value, "CallExpression")) {
      const callee = stripParenExpression(value.callee);
      return Boolean(
        isNodeOfType(callee, "Identifier") && /^(?:create|make)Local[A-Z_]/.test(callee.name),
      );
    }
    if (!isNodeOfType(value, "Identifier")) return false;
    return receiverIsUpdaterLocal(
      value,
      updaterFunction,
      executedFunctions,
      context,
      new Set([...visitedSymbolIds, objectSymbol.id]),
    );
  }
  return false;
};

const receiverIsUpdaterLocal = (
  receiver: EsTreeNode,
  updaterFunction: EsTreeNode,
  executedFunctions: ReadonlySet<EsTreeNode>,
  context: RuleContext,
  visitedSymbolIds: Set<number> = new Set(),
): boolean => {
  const unwrappedReceiver = stripParenExpression(receiver);
  if (isNodeOfType(unwrappedReceiver, "MemberExpression")) {
    return memberReceiverIsUpdaterLocal(
      unwrappedReceiver,
      updaterFunction,
      executedFunctions,
      context,
      visitedSymbolIds,
    );
  }
  const baseIdentifier = baseReceiverIdentifier(receiver);
  if (!baseIdentifier) return false;
  const symbol = context.scopes.symbolFor(baseIdentifier);
  if (!symbol || visitedSymbolIds.has(symbol.id)) return false;
  visitedSymbolIds.add(symbol.id);
  const isDeclaredInsideUpdater = [...executedFunctions].some((functionNode) =>
    isAstDescendant(symbol.bindingIdentifier, functionNode),
  );
  if (!isDeclaredInsideUpdater) return false;
  if (symbol.kind === "parameter") {
    const parameterFunction = [...executedFunctions].find(
      (functionNode) =>
        isFunctionLike(functionNode) &&
        functionNode.params.some((parameter) => {
          const binding = isNodeOfType(parameter, "AssignmentPattern") ? parameter.left : parameter;
          return (
            isNodeOfType(binding, "Identifier") &&
            context.scopes.symbolFor(binding)?.id === symbol.id
          );
        }),
    );
    if (parameterFunction === updaterFunction) return true;
    if (!parameterFunction || !isFunctionLike(parameterFunction)) return false;
    const parameterIndex = parameterFunction.params.findIndex((parameter) => {
      const binding = isNodeOfType(parameter, "AssignmentPattern") ? parameter.left : parameter;
      return (
        isNodeOfType(binding, "Identifier") && context.scopes.symbolFor(binding)?.id === symbol.id
      );
    });
    if (parameterIndex < 0) return false;
    let didFindDirectInvocation = false;
    let doAllArgumentsStayLocal = true;
    for (const executedFunction of executedFunctions) {
      walkOwnFunctionScope(executedFunction, (child: EsTreeNode) => {
        if (!doAllArgumentsStayLocal || !isNodeOfType(child, "CallExpression")) return;
        if (resolveCalledLocalFunction(child, context) !== parameterFunction) return;
        didFindDirectInvocation = true;
        const argument = child.arguments?.[parameterIndex];
        if (
          !argument ||
          isNodeOfType(argument, "SpreadElement") ||
          !receiverIsUpdaterLocal(
            argument,
            updaterFunction,
            executedFunctions,
            context,
            new Set(visitedSymbolIds),
          )
        ) {
          doAllArgumentsStayLocal = false;
        }
      });
    }
    return didFindDirectInvocation && doAllArgumentsStayLocal;
  }
  const initializer = symbol.initializer ? stripParenExpression(symbol.initializer) : null;
  if (!initializer) return false;
  if (
    isNodeOfType(initializer, "ObjectExpression") ||
    isNodeOfType(initializer, "ArrayExpression")
  ) {
    return true;
  }
  if (isNodeOfType(initializer, "NewExpression")) {
    const constructor = stripParenExpression(initializer.callee);
    return Boolean(
      isNodeOfType(constructor, "Identifier") &&
      FRESH_CONTAINER_CONSTRUCTOR_NAMES.has(constructor.name) &&
      context.scopes.isGlobalReference(constructor),
    );
  }
  if (!isNodeOfType(initializer, "Identifier")) return false;
  return receiverIsUpdaterLocal(
    initializer,
    updaterFunction,
    executedFunctions,
    context,
    visitedSymbolIds,
  );
};

const memberWriteHasExternalReceiver = (
  member: EsTreeNodeOfType<"MemberExpression">,
  updaterFunction: EsTreeNode,
  executedFunctions: ReadonlySet<EsTreeNode>,
  context: RuleContext,
): boolean => {
  const baseIdentifier = baseReceiverIdentifier(member.object);
  if (!baseIdentifier) return false;
  if (!context.scopes.symbolFor(baseIdentifier)) return true;
  return !receiverIsUpdaterLocal(member.object, updaterFunction, executedFunctions, context);
};

const getExternallyVisiblePropertyWrite = (
  node: EsTreeNode,
  updaterFunction: EsTreeNode,
  executedFunctions: ReadonlySet<EsTreeNode>,
  context: RuleContext,
): EsTreeNode | null => {
  let writeTarget: EsTreeNode | null = null;
  if (isNodeOfType(node, "AssignmentExpression")) {
    writeTarget = stripParenExpression(node.left);
  } else if (isNodeOfType(node, "UpdateExpression")) {
    writeTarget = stripParenExpression(node.argument);
  } else if (isNodeOfType(node, "UnaryExpression") && node.operator === "delete") {
    writeTarget = stripParenExpression(node.argument);
  }
  return writeTarget &&
    isNodeOfType(writeTarget, "MemberExpression") &&
    memberWriteHasExternalReceiver(writeTarget, updaterFunction, executedFunctions, context)
    ? node
    : null;
};

const isStaticallyUnreachable = (node: EsTreeNode, boundary: EsTreeNode): boolean => {
  let current: EsTreeNode | null | undefined = node;
  while (current && current !== boundary) {
    const parent: EsTreeNode | null | undefined = current.parent;
    if (parent && isNodeOfType(parent, "IfStatement")) {
      const test = stripParenExpression(parent.test);
      if (isNodeOfType(test, "Literal") && typeof test.value === "boolean") {
        if (
          (parent.consequent === current && !test.value) ||
          (parent.alternate === current && test.value)
        ) {
          return true;
        }
      }
    }
    if (parent && isNodeOfType(parent, "LogicalExpression") && parent.right === current) {
      const left = stripParenExpression(parent.left);
      if (
        isNodeOfType(left, "Literal") &&
        ((parent.operator === "&&" && !left.value) ||
          (parent.operator === "||" && Boolean(left.value)))
      ) {
        return true;
      }
    }
    current = parent;
  }
  return false;
};

const getCallName = (call: EsTreeNodeOfType<"CallExpression">): string | null => {
  const callee = stripParenExpression(call.callee);
  if (isNodeOfType(callee, "Identifier")) return callee.name;
  return isNodeOfType(callee, "MemberExpression") ? getStaticPropertyName(callee) : null;
};

const identifierIsCallbackParameter = (identifier: EsTreeNode, context: RuleContext): boolean => {
  if (!isNodeOfType(identifier, "Identifier")) return false;
  const symbol = context.scopes.symbolFor(identifier);
  if (symbol?.kind !== "parameter") return false;
  const bindingParent = symbol.bindingIdentifier.parent;
  return Boolean(
    isNodeOfType(bindingParent, "Property") &&
    /^on[A-Z]/.test(getStaticPropertyKeyName(bindingParent, { allowComputedString: true }) ?? ""),
  );
};

const identifierLooksSideEffecting = (identifier: EsTreeNode): boolean =>
  isNodeOfType(identifier, "Identifier") && SIDE_EFFECT_CALL_NAME_PATTERN.test(identifier.name);

const expressionLooksLikeExternalCallback = (expression: EsTreeNode): boolean => {
  const unwrappedExpression = stripParenExpression(expression);
  if (identifierLooksSideEffecting(unwrappedExpression)) return true;
  return Boolean(
    isNodeOfType(unwrappedExpression, "MemberExpression") &&
    SIDE_EFFECT_CALL_NAME_PATTERN.test(getStaticPropertyName(unwrappedExpression) ?? ""),
  );
};

const freshObjectMethodIsExternalCallback = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
  invocationReferenceNode: EsTreeNode,
  context: RuleContext,
): boolean => {
  const effectiveValue = resolveEffectiveDirectObjectMethodValue(
    callExpression,
    invocationReferenceNode,
    context,
  );
  if (!effectiveValue) return false;
  const unwrappedValue = stripParenExpression(effectiveValue);
  if (
    isNodeOfType(unwrappedValue, "Identifier") &&
    GLOBAL_SIDE_EFFECT_CALL_NAMES.has(unwrappedValue.name) &&
    context.scopes.isGlobalReference(unwrappedValue)
  ) {
    return true;
  }
  return expressionLooksLikeExternalCallback(unwrappedValue);
};

const memberReceiverIsFreshObjectLiteral = (
  callee: EsTreeNodeOfType<"MemberExpression">,
  context: RuleContext,
): boolean => {
  const receiver = stripParenExpression(callee.object);
  if (!isNodeOfType(receiver, "Identifier")) return false;
  const receiverSymbol = resolveConstIdentifierAlias(receiver, context.scopes);
  return Boolean(
    receiverSymbol?.initializer &&
    isNodeOfType(stripParenExpression(receiverSymbol.initializer), "ObjectExpression"),
  );
};

const receiverIsProvenEmptyCollection = (expression: EsTreeNode, context: RuleContext): boolean => {
  const receiver = stripParenExpression(expression);
  if (isNodeOfType(receiver, "ArrayExpression")) return receiver.elements.length === 0;
  if (!isNodeOfType(receiver, "Identifier")) return false;
  const rootReceiverSymbol = resolveConstIdentifierAlias(receiver, context.scopes);
  const initializer = rootReceiverSymbol?.initializer
    ? stripParenExpression(rootReceiverSymbol.initializer)
    : null;
  if (
    !rootReceiverSymbol ||
    rootReceiverSymbol.kind !== "const" ||
    !isNodeOfType(initializer, "ArrayExpression") ||
    initializer.elements.length !== 0
  ) {
    return false;
  }
  const receiverReferences = collectConstAliasSymbols(rootReceiverSymbol, context.scopes).flatMap(
    (receiverSymbol) => receiverSymbol.references,
  );
  return receiverReferences.every((reference) => {
    const identifierRoot = findTransparentExpressionRoot(reference.identifier);
    const referenceParent = identifierRoot.parent;
    if (
      isNodeOfType(referenceParent, "VariableDeclarator") &&
      referenceParent.init === identifierRoot &&
      isNodeOfType(referenceParent.id, "Identifier") &&
      context.scopes.symbolFor(referenceParent.id)?.kind === "const"
    ) {
      return true;
    }
    if (
      isNodeOfType(referenceParent, "CallExpression") &&
      referenceParent.arguments?.[0] === identifierRoot
    ) {
      const callee = stripParenExpression(referenceParent.callee);
      if (isNodeOfType(callee, "MemberExpression") && getStaticPropertyName(callee) === "from") {
        const arrayReceiver = stripParenExpression(callee.object);
        if (
          isNodeOfType(arrayReceiver, "Identifier") &&
          arrayReceiver.name === "Array" &&
          context.scopes.isGlobalReference(arrayReceiver)
        ) {
          return true;
        }
      }
    }
    if (
      !isNodeOfType(referenceParent, "MemberExpression") ||
      stripParenExpression(referenceParent.object) !== identifierRoot ||
      getStaticPropertyName(referenceParent) === null
    ) {
      return false;
    }
    const memberRoot = findTransparentExpressionRoot(referenceParent);
    const memberParent = memberRoot.parent;
    if (
      memberParent &&
      ((isNodeOfType(memberParent, "AssignmentExpression") && memberParent.left === memberRoot) ||
        (isNodeOfType(memberParent, "UpdateExpression") && memberParent.argument === memberRoot) ||
        (isNodeOfType(memberParent, "UnaryExpression") &&
          memberParent.operator === "delete" &&
          memberParent.argument === memberRoot))
    ) {
      return false;
    }
    if (
      memberParent &&
      isNodeOfType(memberParent, "CallExpression") &&
      memberParent.callee === memberRoot
    ) {
      return SYNCHRONOUS_CALLBACK_METHOD_NAMES.has(getStaticPropertyName(referenceParent) ?? "");
    }
    return true;
  });
};

const callHasImmediateSideEffectCallback = (
  call: EsTreeNodeOfType<"CallExpression">,
  updaterFunction: EsTreeNode,
  updaterParameterIsArray: boolean,
  arrayParameterSymbolIds: ReadonlySet<number>,
  context: RuleContext,
): boolean => {
  const callee = stripParenExpression(call.callee);
  if (isNodeOfType(callee, "MemberExpression")) {
    const receiver = stripParenExpression(callee.object);
    const sourceArgument = call.arguments?.[0];
    const mapperArgument = call.arguments?.[1];
    if (
      getStaticPropertyName(callee) === "from" &&
      isNodeOfType(receiver, "Identifier") &&
      receiver.name === "Array" &&
      context.scopes.isGlobalReference(receiver) &&
      Boolean(sourceArgument) &&
      !isNodeOfType(sourceArgument, "SpreadElement") &&
      !receiverIsProvenEmptyCollection(sourceArgument, context) &&
      mapperArgument &&
      !isNodeOfType(mapperArgument, "SpreadElement") &&
      expressionLooksLikeExternalCallback(mapperArgument)
    ) {
      return true;
    }
  }
  if (
    !isNodeOfType(callee, "MemberExpression") ||
    !SYNCHRONOUS_CALLBACK_METHOD_NAMES.has(getStaticPropertyName(callee) ?? "") ||
    !receiverIsKnownSynchronousCollection(
      callee.object,
      updaterFunction,
      updaterParameterIsArray,
      arrayParameterSymbolIds,
      context,
    ) ||
    resolveCalledLocalFunction(call, context)
  ) {
    return false;
  }
  if (receiverIsProvenEmptyCollection(callee.object, context)) return false;
  const callbackArgument = call.arguments?.[0];
  return Boolean(
    callbackArgument &&
    !isNodeOfType(callbackArgument, "SpreadElement") &&
    expressionLooksLikeExternalCallback(stripParenExpression(callbackArgument)),
  );
};

const receiverIsKnownSynchronousCollection = (
  expression: EsTreeNode,
  updaterFunction: EsTreeNode,
  updaterParameterIsArray: boolean,
  arrayParameterSymbolIds: ReadonlySet<number>,
  context: RuleContext,
): boolean => {
  const receiver = stripParenExpression(expression);
  if (isNodeOfType(receiver, "ArrayExpression")) return true;
  if (!isNodeOfType(receiver, "Identifier")) return false;
  const symbol = context.scopes.symbolFor(receiver);
  if (!symbol) return false;
  if (arrayParameterSymbolIds.has(symbol.id)) return true;
  const firstParameter = isFunctionLike(updaterFunction) ? updaterFunction.params?.[0] : null;
  if (
    isNodeOfType(firstParameter, "Identifier") &&
    context.scopes.symbolFor(firstParameter)?.id === symbol.id &&
    updaterParameterIsArray
  ) {
    return true;
  }
  if (functionParameterIsArray(updaterFunction, receiver, context)) return true;
  const initializer = symbol.initializer ? stripParenExpression(symbol.initializer) : null;
  if (isNodeOfType(initializer, "ArrayExpression")) return true;
  if (!isNodeOfType(initializer, "NewExpression")) return false;
  const constructor = stripParenExpression(initializer.callee);
  return Boolean(
    isNodeOfType(constructor, "Identifier") &&
    constructor.name === "Array" &&
    context.scopes.isGlobalReference(constructor),
  );
};

const callHasSideEffectName = (
  call: EsTreeNodeOfType<"CallExpression">,
  updaterFunction: EsTreeNode,
  executedFunctions: ReadonlySet<EsTreeNode>,
  invocationReferenceNode: EsTreeNode,
  context: RuleContext,
): boolean => {
  const callName = getCallName(call);
  if (!callName) return false;
  const callee = stripParenExpression(call.callee);
  const isDiscardedExternalCallbackCall =
    isResultDiscardedCall(call) &&
    (identifierIsCallbackParameter(callee, context) ||
      (isNodeOfType(callee, "MemberExpression") &&
        /^on[A-Z]/.test(getStaticPropertyName(callee) ?? "")));
  if (isNodeOfType(callee, "MemberExpression")) {
    const globalReceiver = baseReceiverIdentifier(callee.object);
    const isGlobalObjectMember = Boolean(
      globalReceiver &&
      GLOBAL_OBJECT_RECEIVER_NAMES.has(globalReceiver.name) &&
      context.scopes.isGlobalReference(globalReceiver),
    );
    if (
      isGlobalObjectMember &&
      (GLOBAL_SIDE_EFFECT_CALL_NAMES.has(callName) || GLOBAL_SCHEDULER_CALL_NAMES.has(callName))
    ) {
      return true;
    }
  }
  if (
    isNodeOfType(callee, "Identifier") &&
    !SIDE_EFFECT_CALL_NAME_PATTERN.test(callName) &&
    !isDiscardedExternalCallbackCall &&
    !(GLOBAL_SIDE_EFFECT_CALL_NAMES.has(callName) && context.scopes.isGlobalReference(callee)) &&
    !(GLOBAL_SCHEDULER_CALL_NAMES.has(callName) && context.scopes.isGlobalReference(callee))
  ) {
    return false;
  }
  if (isDiscardedExternalCallbackCall) return true;
  if (
    isNodeOfType(callee, "MemberExpression") &&
    freshObjectMethodIsExternalCallback(call, invocationReferenceNode, context)
  ) {
    return true;
  }
  if (
    isNodeOfType(callee, "MemberExpression") &&
    !SIDE_EFFECT_CALL_NAME_PATTERN.test(callName) &&
    !SIDE_EFFECT_METHOD_NAMES.has(callName) &&
    !isDiscardedExternalCallbackCall
  ) {
    return false;
  }
  if (!isNodeOfType(callee, "MemberExpression")) return true;
  const receiver = stripParenExpression(callee.object);
  const baseIdentifier = baseReceiverIdentifier(receiver);
  if (
    baseIdentifier &&
    SAFE_GLOBAL_RECEIVER_NAMES.has(baseIdentifier.name) &&
    context.scopes.isGlobalReference(baseIdentifier)
  ) {
    return false;
  }
  if (
    isNodeOfType(callee, "MemberExpression") &&
    memberReceiverIsFreshObjectLiteral(callee, context)
  ) {
    return false;
  }
  return !receiverIsUpdaterLocal(receiver, updaterFunction, executedFunctions, context);
};

const nodeIsReachable = (
  node: EsTreeNode,
  functionCfg: FunctionCfg,
  reachableBlockIdsByCfg: WeakMap<FunctionCfg, ReadonlySet<number>>,
): boolean => {
  const targetBlock = functionCfg.blockOf(node);
  if (!targetBlock) return false;
  const cachedBlockIds = reachableBlockIdsByCfg.get(functionCfg);
  if (cachedBlockIds) return cachedBlockIds.has(targetBlock.id);
  const pendingBlocks = [functionCfg.entry];
  const visitedBlockIds = new Set([functionCfg.entry.id]);
  while (pendingBlocks.length > 0) {
    const block = pendingBlocks.pop();
    if (!block) break;
    for (const edge of block.successors) {
      if (visitedBlockIds.has(edge.to.id)) continue;
      visitedBlockIds.add(edge.to.id);
      pendingBlocks.push(edge.to);
    }
  }
  reachableBlockIdsByCfg.set(functionCfg, visitedBlockIds);
  return visitedBlockIds.has(targetBlock.id);
};

const collectExecutedFunctions = (
  updaterFunction: EsTreeNode,
  updaterParameterIsArray: boolean,
  invocationReferenceNode: EsTreeNode,
  context: RuleContext,
): ExecutedFunctionAnalysis => {
  const executedFunctions = new Set<EsTreeNode>([updaterFunction]);
  const arrayParameterSymbolIds = new Set<number>();
  const reachableBlockIdsByCfg = new WeakMap<FunctionCfg, ReadonlySet<number>>();
  if (updaterParameterIsArray && isFunctionLike(updaterFunction)) {
    const firstParameter = updaterFunction.params?.[0];
    if (isNodeOfType(firstParameter, "Identifier")) {
      const firstParameterSymbol = context.scopes.symbolFor(firstParameter);
      if (firstParameterSymbol) arrayParameterSymbolIds.add(firstParameterSymbol.id);
    }
  }
  const pendingFunctions = [updaterFunction];
  while (pendingFunctions.length > 0) {
    const currentFunction = pendingFunctions.pop();
    if (!currentFunction) break;
    const currentFunctionCfg = context.cfg.cfgFor(currentFunction);
    walkOwnFunctionScope(currentFunction, (child: EsTreeNode) => {
      if (isStaticallyUnreachable(child, currentFunction)) return;
      if (
        currentFunctionCfg &&
        !nodeIsReachable(child, currentFunctionCfg, reachableBlockIdsByCfg)
      ) {
        return;
      }
      if (isNodeOfType(child, "NewExpression")) {
        const constructor = stripParenExpression(child.callee);
        if (
          isNodeOfType(constructor, "Identifier") &&
          constructor.name === "Promise" &&
          context.scopes.isGlobalReference(constructor)
        ) {
          const executor = child.arguments?.[0];
          if (executor && !isNodeOfType(executor, "SpreadElement")) {
            const executorFunction = resolveLocalFunction(executor, context);
            if (executorFunction && !executedFunctions.has(executorFunction)) {
              executedFunctions.add(executorFunction);
              pendingFunctions.push(executorFunction);
            }
          }
        }
        return;
      }
      if (!isNodeOfType(child, "CallExpression")) return;
      if (isReactStateSetterCall(child, context)) {
        const updaterArgument = child.arguments?.[0];
        if (!updaterArgument || isNodeOfType(updaterArgument, "SpreadElement")) return;
        const nestedUpdater = resolveLocalFunction(updaterArgument, context);
        if (nestedUpdater && !executedFunctions.has(nestedUpdater)) {
          executedFunctions.add(nestedUpdater);
          pendingFunctions.push(nestedUpdater);
        }
        return;
      }
      const callee = stripParenExpression(child.callee);
      const directFunction = resolveCalledLocalFunction(child, context, invocationReferenceNode);
      if (directFunction && isFunctionLike(directFunction)) {
        for (const [parameterIndex, parameter] of (directFunction.params ?? []).entries()) {
          const binding = isNodeOfType(parameter, "AssignmentPattern") ? parameter.left : parameter;
          const argument = child.arguments?.[parameterIndex];
          if (
            !isNodeOfType(binding, "Identifier") ||
            !argument ||
            isNodeOfType(argument, "SpreadElement") ||
            !receiverIsKnownSynchronousCollection(
              argument,
              currentFunction,
              currentFunction === updaterFunction && updaterParameterIsArray,
              arrayParameterSymbolIds,
              context,
            )
          ) {
            continue;
          }
          const parameterSymbol = context.scopes.symbolFor(binding);
          if (parameterSymbol) arrayParameterSymbolIds.add(parameterSymbol.id);
        }
      }
      if (directFunction && !executedFunctions.has(directFunction)) {
        executedFunctions.add(directFunction);
        pendingFunctions.push(directFunction);
      }
      const arrayReceiver = isNodeOfType(callee, "MemberExpression")
        ? stripParenExpression(callee.object)
        : null;
      if (
        isNodeOfType(callee, "MemberExpression") &&
        getStaticPropertyName(callee) === "from" &&
        isNodeOfType(arrayReceiver, "Identifier") &&
        arrayReceiver.name === "Array" &&
        context.scopes.isGlobalReference(arrayReceiver)
      ) {
        const sourceArgument = child.arguments?.[0];
        const mapperArgument = child.arguments?.[1];
        if (
          sourceArgument &&
          !isNodeOfType(sourceArgument, "SpreadElement") &&
          !receiverIsProvenEmptyCollection(sourceArgument, context) &&
          mapperArgument &&
          !isNodeOfType(mapperArgument, "SpreadElement")
        ) {
          const mapperFunction = resolveLocalFunction(mapperArgument, context);
          if (mapperFunction && !executedFunctions.has(mapperFunction)) {
            executedFunctions.add(mapperFunction);
            pendingFunctions.push(mapperFunction);
          }
        }
      }
      if (
        !isNodeOfType(callee, "MemberExpression") ||
        !SYNCHRONOUS_CALLBACK_METHOD_NAMES.has(getStaticPropertyName(callee) ?? "") ||
        !receiverIsKnownSynchronousCollection(
          callee.object,
          currentFunction,
          currentFunction === updaterFunction && updaterParameterIsArray,
          arrayParameterSymbolIds,
          context,
        ) ||
        directFunction
      ) {
        return;
      }
      if (receiverIsProvenEmptyCollection(callee.object, context)) return;
      const callbackArgument = child.arguments?.[0];
      if (!callbackArgument || isNodeOfType(callbackArgument, "SpreadElement")) return;
      const callbackFunction = resolveLocalFunction(callbackArgument, context);
      if (!callbackFunction || executedFunctions.has(callbackFunction)) return;
      executedFunctions.add(callbackFunction);
      pendingFunctions.push(callbackFunction);
    });
  }
  return { arrayParameterSymbolIds, functions: executedFunctions };
};

export const noSideEffectInStateUpdaterFunction = defineRule({
  id: "no-side-effect-in-state-updater-function",
  title: "Side effect inside a state updater function",
  severity: "warn",
  category: "Correctness",
  recommendation:
    "React may replay a state updater, so callbacks, analytics, and persistence inside it can run more than once. Compute state purely, then perform the side effect outside the setter.",
  create: (context: RuleContext) => {
    const reachableBlockIdsByCfg = new WeakMap<FunctionCfg, ReadonlySet<number>>();
    const reportedSideEffectNodes = new WeakSet<EsTreeNode>();
    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (!isReactStateSetterCall(node, context)) return;
        const updaterArgument = node.arguments[0];
        if (!updaterArgument || isNodeOfType(updaterArgument, "SpreadElement")) return;
        const updaterFunction = resolveLocalFunction(updaterArgument, context);
        if (!updaterFunction) return;
        const updaterParameterIsArray = stateValueIsArray(node, context);
        const executedFunctionAnalysis = collectExecutedFunctions(
          updaterFunction,
          updaterParameterIsArray,
          node,
          context,
        );
        const executedFunctions = executedFunctionAnalysis.functions;
        for (const executedFunction of executedFunctions) {
          const functionCfg = context.cfg.cfgFor(executedFunction);
          walkOwnFunctionScope(executedFunction, (child: EsTreeNode) => {
            if (isStaticallyUnreachable(child, executedFunction)) return;
            if (functionCfg && !nodeIsReachable(child, functionCfg, reachableBlockIdsByCfg)) return;
            const propertyWrite = getExternallyVisiblePropertyWrite(
              child,
              updaterFunction,
              executedFunctions,
              context,
            );
            if (propertyWrite) {
              if (!reportedSideEffectNodes.has(propertyWrite)) {
                reportedSideEffectNodes.add(propertyWrite);
                context.report({ node: propertyWrite, message: MESSAGE });
              }
              return;
            }
            if (!isNodeOfType(child, "CallExpression")) return;
            if (child !== node && isReactStateSetterCall(child, context)) {
              if (!reportedSideEffectNodes.has(child)) {
                reportedSideEffectNodes.add(child);
                context.report({ node: child, message: MESSAGE });
              }
              return;
            }
            const resolvedFunction = resolveCalledLocalFunction(child, context, node);
            if (resolvedFunction && executedFunctions.has(resolvedFunction)) return;
            if (
              callHasImmediateSideEffectCallback(
                child,
                executedFunction,
                executedFunction === updaterFunction && updaterParameterIsArray,
                executedFunctionAnalysis.arrayParameterSymbolIds,
                context,
              )
            ) {
              if (!reportedSideEffectNodes.has(child)) {
                reportedSideEffectNodes.add(child);
                context.report({ node: child, message: MESSAGE });
              }
              return;
            }
            if (!callHasSideEffectName(child, updaterFunction, executedFunctions, node, context)) {
              return;
            }
            if (reportedSideEffectNodes.has(child)) return;
            reportedSideEffectNodes.add(child);
            context.report({ node: child, message: MESSAGE });
          });
        }
      },
    };
  },
});
