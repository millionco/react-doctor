import { isRejectableOidcUserManagerCall } from "../../utils/is-rejectable-oidc-user-manager-call.js";
import type { ImmediateIifeFetchProviderCheck } from "./utils/create-immediate-iife-fetch-provider-check.js";
import { createImmediateIifeFetchProviderCheck } from "./utils/create-immediate-iife-fetch-provider-check.js";
import { isImmediateIifeNativeGlobalReference } from "./utils/is-immediate-iife-native-global-reference.js";
import type { SymbolDescriptor } from "../../semantic/scope-analysis.js";
import { getImportedName } from "../../utils/get-imported-name.js";
import { getValueImportSource } from "../../utils/get-value-import-declaration.js";
import { isNodeReachableWithinFunction } from "../../utils/is-node-reachable-within-function.js";
import { findEnclosingClass } from "../../utils/find-enclosing-class.js";
import { SECOND_ARGUMENT_INDEX } from "./utils/effect/constants.js";
import { someAst } from "../../utils/some-ast.js";
import { defineRule } from "../../utils/define-rule.js";
import { doNodesCoverEveryPathAfterNode } from "../../utils/do-nodes-cover-every-path-after-node.js";
import { getEffectCallback } from "../../utils/get-effect-callback.js";
import { findGuardingTryStatement } from "../../utils/find-guarding-try-statement.js";
import { getDirectUnreassignedInitializer } from "../../utils/get-direct-unreassigned-initializer.js";
import { getImportSourceForName } from "../../utils/find-import-source-for-name.js";
import { getRangeStart } from "../../utils/get-range-start.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isProvenNonThrowingBuiltInCall } from "../../utils/is-proven-non-throwing-built-in-call.js";
import {
  chainCarriesRejectionHandler,
  isDefinitelyNonThenableValue,
} from "../../utils/is-never-rejecting-expression.js";
import { isReactApiCall } from "../../utils/is-react-api-call.js";
import { isReactHookResultReference } from "../../utils/is-react-hook-result-reference.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveExactLocalFunction } from "../../utils/resolve-exact-local-function.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkOwnFunctionScope } from "../../utils/walk-own-function-scope.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";

const PROMISE_METHOD_NAMES = new Set(["then", "catch", "finally"]);
const REJECTING_PROMISE_COMBINATOR_NAMES = new Set(["all", "race", "any"]);
const MAX_INITIATOR_RESOLUTION_DEPTH = 3;
const STATE_DISPATCHER_HOOK_NAMES = new Set(["useState", "useReducer"]);
const REF_HOOK_NAMES = new Set(["useRef"]);
const MESSAGE =
  "This promise chain runs in an effect, ends in a `.then` that sets state or mutates a ref, and has no `.catch` or enclosing try/catch, so a rejection leaves the state unset and surfaces as an unhandled rejection. Add a `.catch` handler on the chain (`.finally` does not count).";

type FunctionLikeNode =
  | EsTreeNodeOfType<"ArrowFunctionExpression">
  | EsTreeNodeOfType<"FunctionExpression">
  | EsTreeNodeOfType<"FunctionDeclaration">;

interface PromiseChainWalk {
  root: EsTreeNode;
  hasCatch: boolean;
  hasRejectionHandlerArgument: boolean;
  sawThen: boolean;
  thenCallbacks: FunctionLikeNode[];
  hasDirectSetterThenCallback: boolean;
}

interface ResolvedInitiator {
  initiator: EsTreeNode;
  hasUpstreamRejectionHandling: boolean;
}
const isKnownNonRejectingHandlerReturn = (
  expression: EsTreeNode,
  context: RuleContext,
  visitedBindingIdentifiers = new Set<EsTreeNode>(),
): boolean => {
  const strippedExpression = stripParenExpression(expression);
  if (isDefinitelyNonThenableValue(strippedExpression)) return true;
  if (
    isNodeOfType(strippedExpression, "CallExpression") &&
    isNodeOfType(strippedExpression.callee, "MemberExpression")
  ) {
    const receiver = stripParenExpression(strippedExpression.callee.object);
    if (
      isNodeOfType(receiver, "Identifier") &&
      receiver.name === "Promise" &&
      context.scopes.isGlobalReference(receiver) &&
      getStaticPropertyName(strippedExpression.callee) === "resolve"
    ) {
      const resolvedValue = strippedExpression.arguments[0];
      return (
        !resolvedValue ||
        (!isNodeOfType(resolvedValue, "SpreadElement") &&
          isKnownNonRejectingHandlerReturn(resolvedValue, context, visitedBindingIdentifiers))
      );
    }
  }
  if (!isNodeOfType(strippedExpression, "Identifier")) return false;
  if (
    strippedExpression.name === "undefined" &&
    context.scopes.isGlobalReference(strippedExpression)
  ) {
    return true;
  }
  const symbol = context.scopes.symbolFor(strippedExpression);
  if (!symbol || visitedBindingIdentifiers.has(symbol.bindingIdentifier)) return false;
  visitedBindingIdentifiers.add(symbol.bindingIdentifier);
  const initializer = getDirectUnreassignedInitializer(symbol);
  return Boolean(
    initializer &&
    isKnownNonRejectingHandlerReturn(initializer, context, visitedBindingIdentifiers),
  );
};
const isKnownNonRejectingHandler = (
  argument: EsTreeNode | undefined,
  context: RuleContext,
): boolean => {
  if (!argument) return false;
  const strippedArgument = stripParenExpression(argument);
  const handler = isNodeOfType(strippedArgument, "Identifier")
    ? resolveExactLocalFunction(strippedArgument, context.scopes)
    : strippedArgument;
  if (!handler || !isFunctionLike(handler)) return false;
  let didFindKnownNonRejectingCall = false;
  let canReject = false;
  walkOwnFunctionScope(handler, (child: EsTreeNode) => {
    if (canReject) return false;
    if (isNodeOfType(child, "ThrowStatement") || isNodeOfType(child, "AwaitExpression")) {
      canReject = true;
      return false;
    }
    if (
      isNodeOfType(child, "ReturnStatement") &&
      child.argument &&
      !isKnownNonRejectingHandlerReturn(child.argument, context)
    ) {
      const returnedExpression = stripParenExpression(child.argument);
      if (!isNodeOfType(returnedExpression, "CallExpression")) {
        canReject = true;
        return false;
      }
    }
    if (isNodeOfType(child, "NewExpression")) {
      canReject = true;
      return false;
    }
    if (!isNodeOfType(child, "CallExpression")) return;
    if (isProvenNonThrowingBuiltInCall(child, context.scopes)) {
      didFindKnownNonRejectingCall = true;
      return;
    }
    const callee = stripParenExpression(child.callee);
    if (
      isNodeOfType(callee, "Identifier") &&
      isReactHookResultReference(callee, STATE_DISPATCHER_HOOK_NAMES, 1, context.scopes)
    ) {
      const symbol = context.scopes.symbolFor(callee);
      if (symbol?.references.every((reference) => reference.flag === "read")) {
        didFindKnownNonRejectingCall = true;
        return;
      }
    }
    canReject = true;
    return false;
  });
  return didFindKnownNonRejectingCall && !canReject;
};
const isTrustedNonThrowingMethodCallee = (
  member: EsTreeNodeOfType<"MemberExpression">,
  context: RuleContext,
): boolean => {
  const parent = member.parent;
  if (!parent || !isNodeOfType(parent, "CallExpression") || parent.callee !== member) return false;
  if (isProvenNonThrowingBuiltInCall(parent, context.scopes)) return true;
  const receiver = stripParenExpression(member.object);
  if (!isNodeOfType(receiver, "Identifier") || !context.scopes.isGlobalReference(receiver)) {
    return false;
  }
  return receiver.name === "Promise" && getStaticPropertyName(member) === "resolve";
};
const handlerHasPotentiallyThrowingMemberRead = (
  argument: EsTreeNode | undefined,
  context: RuleContext,
): boolean => {
  if (!argument) return false;
  const strippedArgument = stripParenExpression(argument);
  const handler = isNodeOfType(strippedArgument, "Identifier")
    ? resolveExactLocalFunction(strippedArgument, context.scopes)
    : strippedArgument;
  if (!handler || !isFunctionLike(handler)) return false;
  let hasPotentiallyThrowingMemberRead = false;
  walkOwnFunctionScope(handler, (child: EsTreeNode) => {
    if (
      isNodeOfType(child, "MemberExpression") &&
      !isTrustedNonThrowingMethodCallee(child, context)
    ) {
      hasPotentiallyThrowingMemberRead = true;
      return false;
    }
  });
  return hasPotentiallyThrowingMemberRead;
};

const hasRejectionHandler = (
  chain: EsTreeNode,
  argument: EsTreeNode | undefined,
  context: RuleContext,
  allowTerminalCatchBlock: boolean,
): boolean => {
  if (!argument) return false;
  if (
    !handlerHasPotentiallyThrowingMemberRead(argument, context) &&
    (chainCarriesRejectionHandler(chain, context.scopes) ||
      isKnownNonRejectingHandler(argument, context))
  ) {
    return true;
  }
  if (!allowTerminalCatchBlock) return false;
  const candidate = stripParenExpression(argument);
  const handler = isNodeOfType(candidate, "Identifier")
    ? resolveExactLocalFunction(candidate, context.scopes)
    : candidate;
  if (!handler || !isFunctionLike(handler)) {
    return (
      isNodeOfType(candidate, "MemberExpression") ||
      (isNodeOfType(candidate, "Identifier") && candidate.name !== "undefined")
    );
  }
  if (!isNodeOfType(handler.body, "BlockStatement")) return false;
  let doesExplicitlyReject = false;
  walkOwnFunctionScope(handler, (child: EsTreeNode) => {
    if (doesExplicitlyReject) return false;
    if (isNodeOfType(child, "ThrowStatement") || isNodeOfType(child, "AwaitExpression")) {
      doesExplicitlyReject = true;
      return false;
    }
    if (
      isNodeOfType(child, "ReturnStatement") &&
      child.argument &&
      !isKnownNonRejectingHandlerReturn(child.argument, context)
    ) {
      doesExplicitlyReject = true;
      return false;
    }
  });
  return !doesExplicitlyReject;
};

const walkPromiseChain = (chainExpression: EsTreeNode, context: RuleContext): PromiseChainWalk => {
  let cursor = stripParenExpression(chainExpression);
  let hasCatch = false;
  let hasRejectionHandlerArgument = false;
  let didReachTerminalThen = false;
  let sawThen = false;
  let hasDirectSetterThenCallback = false;
  const thenCallbacks: FunctionLikeNode[] = [];

  while (
    isNodeOfType(cursor, "CallExpression") &&
    isNodeOfType(cursor.callee, "MemberExpression") &&
    PROMISE_METHOD_NAMES.has(getStaticPropertyName(cursor.callee) ?? "")
  ) {
    const methodName = getStaticPropertyName(cursor.callee);
    const rejectionHandlerArgument =
      methodName === "catch"
        ? (cursor.arguments[0] as EsTreeNode | undefined)
        : (cursor.arguments[1] as EsTreeNode | undefined);
    if (
      !didReachTerminalThen &&
      methodName === "catch" &&
      hasRejectionHandler(cursor, rejectionHandlerArgument, context, true)
    ) {
      hasCatch = true;
    }
    if (methodName === "then") {
      if (
        !didReachTerminalThen &&
        hasRejectionHandler(cursor, rejectionHandlerArgument, context, false)
      ) {
        hasRejectionHandlerArgument = true;
      }
      didReachTerminalThen = true;
      sawThen = true;
      const callbackArgument = cursor.arguments[0];
      const callback = callbackArgument ? stripParenExpression(callbackArgument) : null;
      if (callback && isFunctionLike(callback)) {
        thenCallbacks.push(callback);
      } else if (callback && isNodeOfType(callback, "Identifier")) {
        if (isReactHookResultReference(callback, STATE_DISPATCHER_HOOK_NAMES, 1, context.scopes)) {
          hasDirectSetterThenCallback = true;
        } else {
          const resolvedCallback = resolveExactLocalFunction(callback, context.scopes);
          if (resolvedCallback && isFunctionLike(resolvedCallback)) {
            thenCallbacks.push(resolvedCallback);
          }
        }
      }
    }
    cursor = stripParenExpression(cursor.callee.object);
  }

  return {
    root: cursor,
    hasCatch,
    hasRejectionHandlerArgument,
    sawThen,
    thenCallbacks,
    hasDirectSetterThenCallback,
  };
};
const resolveRootInitiator = (root: EsTreeNode, context: RuleContext): ResolvedInitiator => {
  let cursor = stripParenExpression(root);
  let hasUpstreamRejectionHandling = false;
  const visitedBindingNames = new Set<string>();
  while (true) {
    const chainWalk = walkPromiseChain(cursor, context);
    if (chainWalk.root !== cursor) {
      if (chainWalk.hasCatch || chainWalk.hasRejectionHandlerArgument) {
        hasUpstreamRejectionHandling = true;
      }
      cursor = stripParenExpression(chainWalk.root);
      continue;
    }
    if (isNodeOfType(cursor, "Identifier") && !visitedBindingNames.has(cursor.name)) {
      visitedBindingNames.add(cursor.name);
      const symbol = context.scopes.symbolFor(cursor);
      if (symbol?.kind === "const" && symbol.initializer && !isFunctionLike(symbol.initializer)) {
        cursor = stripParenExpression(symbol.initializer);
        continue;
      }
    }
    return { initiator: cursor, hasUpstreamRejectionHandling };
  }
};
const memberLookupResolvesToRejectableFunction = (
  memberNode: EsTreeNodeOfType<"MemberExpression">,
  remainingDepth: number,
  context: RuleContext,
): boolean => {
  const strippedObject = stripParenExpression(memberNode.object);
  const objectSymbol = isNodeOfType(strippedObject, "Identifier")
    ? context.scopes.symbolFor(strippedObject)
    : null;
  const boundInitializer = objectSymbol?.kind === "const" ? objectSymbol.initializer : null;
  const objectExpression = boundInitializer
    ? stripParenExpression(boundInitializer)
    : strippedObject;
  if (!isNodeOfType(objectExpression, "ObjectExpression")) return false;
  const lookedUpName = getStaticPropertyName(memberNode);
  const candidateProperties = objectExpression.properties.filter((property) => {
    if (!isNodeOfType(property, "Property")) return false;
    if (lookedUpName === null) return true;
    const keyMatches = isNodeOfType(property.key, "Identifier")
      ? property.key.name === lookedUpName
      : isNodeOfType(property.key, "Literal") && property.key.value === lookedUpName;
    return keyMatches;
  });
  if (candidateProperties.length === 0) return false;
  return candidateProperties.every((property) => {
    if (!isNodeOfType(property, "Property")) return false;
    const value = stripParenExpression(property.value);
    return (
      isFunctionLike(value) && functionHasUnhandledRejectableSource(value, remainingDepth, context)
    );
  });
};
const isProvablyRejectableExpression = (
  expression: EsTreeNode,
  remainingDepth: number,
  context: RuleContext,
): boolean => {
  const stripped = stripParenExpression(expression);
  if (isNodeOfType(stripped, "ImportExpression")) return true;
  if (isNodeOfType(stripped, "AwaitExpression")) {
    return isProvablyRejectableExpression(stripped.argument, remainingDepth, context);
  }
  if (!isNodeOfType(stripped, "CallExpression")) return false;
  if (isRejectableOidcUserManagerCall(stripped, context)) return true;
  const callee = stripParenExpression(stripped.callee);
  if (isNodeOfType(callee, "Identifier")) {
    if (callee.name === "fetch" && context.scopes.isGlobalReference(callee)) {
      return true;
    }
    if (remainingDepth <= 0) return false;
    const localFunction = resolveExactLocalFunction(callee, context.scopes);
    if (localFunction && isFunctionLike(localFunction)) {
      return functionHasUnhandledRejectableSource(localFunction, remainingDepth - 1, context);
    }
    const symbol = context.scopes.symbolFor(callee);
    if (symbol?.kind !== "const" || !symbol.initializer) return false;
    const strippedInitializer = stripParenExpression(symbol.initializer);
    if (isNodeOfType(strippedInitializer, "MemberExpression")) {
      return memberLookupResolvesToRejectableFunction(
        strippedInitializer,
        remainingDepth - 1,
        context,
      );
    }
    return false;
  }
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  if (
    isNodeOfType(callee.object, "Identifier") &&
    callee.object.name === "Promise" &&
    context.scopes.isGlobalReference(callee.object)
  ) {
    if (!REJECTING_PROMISE_COMBINATOR_NAMES.has(getStaticPropertyName(callee) ?? "")) return false;
    const combinatorInput = stripped.arguments[0]
      ? stripParenExpression(stripped.arguments[0])
      : null;
    if (!combinatorInput || !isNodeOfType(combinatorInput, "ArrayExpression")) return false;
    return combinatorInput.elements.some((element) => {
      if (!element || isNodeOfType(element, "SpreadElement")) return false;
      const resolvedElement = resolveRootInitiator(element, context);
      return (
        !resolvedElement.hasUpstreamRejectionHandling &&
        isProvablyRejectableExpression(resolvedElement.initiator, remainingDepth, context)
      );
    });
  }
  if (remainingDepth > 0) {
    return memberLookupResolvesToRejectableFunction(callee, remainingDepth - 1, context);
  }
  return false;
};
const functionHasUnhandledRejectableSource = (
  functionNode: FunctionLikeNode,
  remainingDepth: number,
  context: RuleContext,
): boolean => {
  let didFindRejectableSource = false;
  const checkCandidate = (candidate: EsTreeNode, isAwaited: boolean): void => {
    if (isAwaited && findGuardingTryStatement(candidate)) return;
    const chainWalk = walkPromiseChain(stripParenExpression(candidate), context);
    if (chainWalk.hasCatch || chainWalk.hasRejectionHandlerArgument) return;
    if (isProvablyRejectableExpression(chainWalk.root, remainingDepth, context)) {
      didFindRejectableSource = true;
    }
  };
  const body = functionNode.body;
  if (body && !isNodeOfType(body, "BlockStatement")) {
    checkCandidate(body, false);
  }
  walkOwnFunctionScope(functionNode, (child: EsTreeNode) => {
    if (didFindRejectableSource) return false;
    if (isNodeOfType(child, "ThrowStatement") && !findGuardingTryStatement(child)) {
      didFindRejectableSource = true;
      return false;
    }
    if (isNodeOfType(child, "AwaitExpression")) {
      checkCandidate(child.argument, true);
    }
    if (isNodeOfType(child, "ReturnStatement") && child.argument) {
      checkCandidate(child.argument, isNodeOfType(child.argument, "AwaitExpression"));
    }
  });
  return didFindRejectableSource;
};
const collectStateSideEffectNodes = (callback: EsTreeNode, context: RuleContext): EsTreeNode[] => {
  const sideEffectNodes: EsTreeNode[] = [];
  walkOwnFunctionScope(callback, (child: EsTreeNode) => {
    if (
      isNodeOfType(child, "CallExpression") &&
      isNodeOfType(child.callee, "Identifier") &&
      isReactHookResultReference(child.callee, STATE_DISPATCHER_HOOK_NAMES, 1, context.scopes)
    ) {
      sideEffectNodes.push(child);
    }
    if (
      isNodeOfType(child, "AssignmentExpression") &&
      isNodeOfType(child.left, "MemberExpression") &&
      getStaticPropertyName(child.left) === "current" &&
      isNodeOfType(stripParenExpression(child.left.object), "Identifier") &&
      isReactHookResultReference(
        stripParenExpression(child.left.object),
        REF_HOOK_NAMES,
        null,
        context.scopes,
      )
    ) {
      sideEffectNodes.push(child);
    }
  });
  return sideEffectNodes;
};
const getReferenceRejectionHandlerCall = (
  reference: EsTreeNode,
  context: RuleContext,
): EsTreeNode | null => {
  const member = reference.parent;
  if (!member || !isNodeOfType(member, "MemberExpression") || member.object !== reference) {
    return null;
  }
  const call = member.parent;
  if (!call || !isNodeOfType(call, "CallExpression") || call.callee !== member) return null;
  const chainWalk = walkPromiseChain(call, context);
  return chainWalk.hasCatch || chainWalk.hasRejectionHandlerArgument ? call : null;
};
const collectBindingRejectionHandlerCalls = (
  binding: EsTreeNode,
  context: RuleContext,
  visitedBindingIdentifiers = new Set<EsTreeNode>(),
): EsTreeNode[] => {
  if (!isNodeOfType(binding, "Identifier")) return [];
  const symbol = context.scopes.symbolFor(binding);
  if (!symbol || visitedBindingIdentifiers.has(symbol.bindingIdentifier)) return [];
  visitedBindingIdentifiers.add(symbol.bindingIdentifier);
  return symbol.references.flatMap((reference) => {
    const rejectionHandlerCall = getReferenceRejectionHandlerCall(reference.identifier, context);
    if (rejectionHandlerCall) return [rejectionHandlerCall];
    const declarator = reference.identifier.parent;
    if (
      !declarator ||
      !isNodeOfType(declarator, "VariableDeclarator") ||
      declarator.init !== reference.identifier ||
      !isNodeOfType(declarator.id, "Identifier")
    ) {
      return [];
    }
    const aliasSymbol = context.scopes.symbolFor(declarator.id);
    if (
      aliasSymbol?.kind !== "const" ||
      aliasSymbol.references.some((aliasReference) => aliasReference.flag !== "read")
    ) {
      return [];
    }
    return collectBindingRejectionHandlerCalls(declarator.id, context, visitedBindingIdentifiers);
  });
};
const bindingHasSingleWriteWithCoveringRejectionHandler = (
  binding: EsTreeNode,
  assignmentValue: EsTreeNode,
  context: RuleContext,
): boolean => {
  if (!isNodeOfType(binding, "Identifier")) return false;
  const symbol = context.scopes.symbolFor(binding);
  if (!symbol) return false;
  const writeReferences = symbol.references.filter((reference) => reference.flag !== "read");
  if (writeReferences.length !== 1 || writeReferences[0]?.identifier !== binding) return false;
  const rejectionHandlerCalls = collectBindingRejectionHandlerCalls(binding, context);
  const doesRejectionHandlerCoverEveryPath = doNodesCoverEveryPathAfterNode(
    assignmentValue,
    rejectionHandlerCalls,
    context,
  );
  if (!doesRejectionHandlerCoverEveryPath) return false;
  const enclosingFunction = context.cfg.enclosingFunction(assignmentValue);
  let ancestor = assignmentValue.parent ?? null;
  let isInsideLoop = false;
  while (ancestor && ancestor !== enclosingFunction) {
    if (
      isNodeOfType(ancestor, "ForStatement") ||
      isNodeOfType(ancestor, "ForInStatement") ||
      isNodeOfType(ancestor, "ForOfStatement") ||
      isNodeOfType(ancestor, "WhileStatement") ||
      isNodeOfType(ancestor, "DoWhileStatement")
    ) {
      isInsideLoop = true;
      break;
    }
    ancestor = ancestor.parent ?? null;
  }
  const functionCfg = enclosingFunction ? context.cfg.cfgFor(enclosingFunction) : null;
  const assignmentBlock = functionCfg?.blockOf(assignmentValue) ?? null;
  const assignmentStart = getRangeStart(assignmentValue);
  const hasSameIterationRejectionHandler = rejectionHandlerCalls.some((rejectionHandlerCall) => {
    const rejectionHandlerStart = getRangeStart(rejectionHandlerCall);
    return (
      assignmentBlock !== null &&
      functionCfg?.blockOf(rejectionHandlerCall) === assignmentBlock &&
      assignmentStart !== null &&
      rejectionHandlerStart !== null &&
      rejectionHandlerStart > assignmentStart
    );
  });
  return !isInsideLoop || hasSameIterationRejectionHandler;
};
const collectFloatingChains = (callback: EsTreeNode, context: RuleContext): EsTreeNode[] => {
  const chains: EsTreeNode[] = [];
  if (
    isNodeOfType(callback, "ArrowFunctionExpression") &&
    !isNodeOfType(callback.body, "BlockStatement")
  ) {
    chains.push(stripParenExpression(callback.body));
    return chains;
  }
  walkOwnFunctionScope(callback, (child: EsTreeNode) => {
    if (isNodeOfType(child, "VariableDeclarator") && child.init) {
      if (
        !doNodesCoverEveryPathAfterNode(
          child.init,
          collectBindingRejectionHandlerCalls(child.id, context),
          context,
        )
      ) {
        chains.push(stripParenExpression(child.init));
      }
      return;
    }
    if (isNodeOfType(child, "ExpressionStatement")) {
      let expression = child.expression as EsTreeNode;
      if (isNodeOfType(expression, "UnaryExpression") && expression.operator === "void") {
        expression = expression.argument as EsTreeNode;
      }
      if (isNodeOfType(expression, "AssignmentExpression")) {
        const assignmentTarget = stripParenExpression(expression.left);
        if (
          expression.operator === "=" &&
          bindingHasSingleWriteWithCoveringRejectionHandler(
            assignmentTarget,
            expression.right,
            context,
          )
        ) {
          return;
        }
        expression = expression.right;
      }
      chains.push(stripParenExpression(expression));
    }
  });
  return chains;
};
const IMMEDIATE_IIFE_MESSAGE =
  "This promise chain runs inside an immediately invoked function in an effect and sets state or mutates a ref without handling rejection. Add a rejection handler to this chain; an outer try/catch or promise catch does not handle a discarded inner chain.";
const immediateIifeReactImportNameBySymbol = new WeakMap<SymbolDescriptor, string | null>();
const unsupportedImmediateIifeHookResultBySymbol = new WeakMap<SymbolDescriptor, boolean>();
const getImmediateIifeReactImportName = (symbol: SymbolDescriptor): string | null => {
  const cachedName = immediateIifeReactImportNameBySymbol.get(symbol);
  if (cachedName !== undefined) return cachedName;
  const importedName = getImportedName(symbol.declarationNode);
  const name =
    getValueImportSource(symbol) === "react" &&
    importedName &&
    symbol.references.every((reference) => reference.flag === "read")
      ? importedName
      : null;
  immediateIifeReactImportNameBySymbol.set(symbol, name);
  return name;
};
const hasUnsupportedImmediateIifeHookResult = (
  identifier: EsTreeNode,
  context: RuleContext,
): boolean => {
  if (!isNodeOfType(identifier, "Identifier")) return false;
  const symbol = context.scopes.symbolFor(identifier);
  if (!symbol) return false;
  const cachedResult = unsupportedImmediateIifeHookResultBySymbol.get(symbol);
  if (cachedResult !== undefined) return cachedResult;
  const isStateResult = isReactHookResultReference(
    identifier,
    STATE_DISPATCHER_HOOK_NAMES,
    SECOND_ARGUMENT_INDEX,
    context.scopes,
  );
  const isRefResult =
    !isStateResult && isReactHookResultReference(identifier, REF_HOOK_NAMES, null, context.scopes);
  let isUnsupported = false;
  if (isStateResult || isRefResult) {
    const declaration = symbol.declarationNode;
    const initializer =
      isNodeOfType(declaration, "VariableDeclarator") && declaration.init
        ? stripParenExpression(declaration.init)
        : null;
    const hookCallee = isNodeOfType(initializer, "CallExpression")
      ? stripParenExpression(initializer.callee)
      : null;
    const hookSymbol = isNodeOfType(hookCallee, "Identifier")
      ? context.scopes.symbolFor(hookCallee)
      : null;
    const hookName = hookSymbol ? getImmediateIifeReactImportName(hookSymbol) : null;
    const hasDirectBinding =
      isNodeOfType(declaration, "VariableDeclarator") &&
      (isStateResult
        ? isNodeOfType(declaration.id, "ArrayPattern") &&
          declaration.id.elements[SECOND_ARGUMENT_INDEX] === symbol.bindingIdentifier
        : declaration.id === symbol.bindingIdentifier);
    isUnsupported =
      symbol.kind !== "const" ||
      symbol.references.some((reference) => reference.flag !== "read") ||
      !hasDirectBinding ||
      !hookName ||
      !(isStateResult ? STATE_DISPATCHER_HOOK_NAMES : REF_HOOK_NAMES).has(hookName);
  }
  unsupportedImmediateIifeHookResultBySymbol.set(symbol, isUnsupported);
  return isUnsupported;
};
const hasSupportedImmediateIifeFetchChain = (
  expression: EsTreeNode,
  context: RuleContext,
  hasUnmodifiedFetchProvider: ImmediateIifeFetchProviderCheck,
): boolean => {
  let cursor = stripParenExpression(expression);
  while (
    isNodeOfType(cursor, "CallExpression") &&
    isNodeOfType(cursor.callee, "MemberExpression")
  ) {
    const methodName = getStaticPropertyName(cursor.callee);
    if ((methodName !== "then" && methodName !== "finally") || cursor.arguments.length !== 1) {
      return false;
    }
    const handlerArgument = cursor.arguments[0];
    if (!handlerArgument) return false;
    const handler = stripParenExpression(handlerArgument);
    if (isNodeOfType(handler, "Identifier")) {
      if (
        methodName !== "then" ||
        !isReactHookResultReference(
          handler,
          STATE_DISPATCHER_HOOK_NAMES,
          SECOND_ARGUMENT_INDEX,
          context.scopes,
        ) ||
        hasUnsupportedImmediateIifeHookResult(handler, context)
      ) {
        return false;
      }
    } else if (
      (!isNodeOfType(handler, "ArrowFunctionExpression") &&
        !isNodeOfType(handler, "FunctionExpression")) ||
      handler.async ||
      handler.generator ||
      handler.params.length > 1 ||
      handler.params.some((parameter) => !isNodeOfType(parameter, "Identifier"))
    ) {
      return false;
    }
    cursor = stripParenExpression(cursor.callee.object);
  }
  if (!isNodeOfType(cursor, "CallExpression") || cursor.arguments.length !== 1) return false;
  const callee = stripParenExpression(cursor.callee);
  const urlArgument = cursor.arguments[0];
  if (!urlArgument) return false;
  const url = stripParenExpression(urlArgument);
  return (
    isNodeOfType(callee, "Identifier") &&
    callee.name === "fetch" &&
    isImmediateIifeNativeGlobalReference(callee, "fetch", context.scopes) &&
    hasUnmodifiedFetchProvider(cursor, expression) &&
    isNodeOfType(url, "Literal") &&
    typeof url.value === "string"
  );
};
const collectImmediateIifeFloatingChains = (
  effectCall: EsTreeNodeOfType<"CallExpression">,
  callback: EsTreeNode,
  context: RuleContext,
): EsTreeNode[] => {
  const effectCallee = stripParenExpression(effectCall.callee);
  const dependencies = effectCall.arguments[SECOND_ARGUMENT_INDEX];
  if (
    !isNodeOfType(effectCallee, "Identifier") ||
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    callback.async ||
    callback.params.length !== 0 ||
    !isNodeOfType(callback.body, "BlockStatement") ||
    effectCall.arguments.length !== 2 ||
    !dependencies ||
    !isNodeOfType(stripParenExpression(dependencies), "ArrayExpression")
  ) {
    return [];
  }
  const effectSymbol = context.scopes.symbolFor(effectCallee);
  if (!effectSymbol) return [];
  const effectName = getImmediateIifeReactImportName(effectSymbol);
  if (effectName !== "useEffect" && effectName !== "useLayoutEffect") return [];
  const chains: EsTreeNode[] = [];
  walkOwnFunctionScope(callback, (child) => {
    if (isNodeOfType(child, "ClassDeclaration") || isNodeOfType(child, "ClassExpression")) {
      return false;
    }
    if (!isNodeOfType(child, "CallExpression") || child.arguments.length !== 0) return;
    const invokedFunction = stripParenExpression(child.callee);
    if (
      (!isNodeOfType(invokedFunction, "ArrowFunctionExpression") &&
        !isNodeOfType(invokedFunction, "FunctionExpression")) ||
      invokedFunction.generator ||
      invokedFunction.params.length !== 0 ||
      !isNodeOfType(invokedFunction.body, "BlockStatement") ||
      !isNodeReachableWithinFunction(child, context)
    ) {
      return;
    }
    if (
      someAst(invokedFunction, (candidate) =>
        hasUnsupportedImmediateIifeHookResult(candidate, context),
      )
    ) {
      return;
    }
    const invokedChains: EsTreeNode[] = [];
    let hasSuspension = false;
    walkOwnFunctionScope(invokedFunction, (descendant) => {
      if (
        isNodeOfType(descendant, "ClassDeclaration") ||
        isNodeOfType(descendant, "ClassExpression")
      ) {
        return false;
      }
      if (
        isNodeOfType(descendant, "AwaitExpression") ||
        isNodeOfType(descendant, "YieldExpression") ||
        (isNodeOfType(descendant, "ForOfStatement") && descendant.await)
      ) {
        hasSuspension = true;
      }
      if (
        !isNodeOfType(descendant, "ExpressionStatement") ||
        !isNodeReachableWithinFunction(descendant, context)
      ) {
        return;
      }
      let expression = stripParenExpression(descendant.expression);
      if (isNodeOfType(expression, "UnaryExpression") && expression.operator === "void") {
        expression = stripParenExpression(expression.argument);
      }
      if (isNodeOfType(expression, "CallExpression")) invokedChains.push(expression);
    });
    if (!hasSuspension) chains.push(...invokedChains);
  });
  return chains;
};
export const noPromiseThenSideEffectInEffectWithoutCatch = defineRule({
  id: "no-promise-then-side-effect-in-effect-without-catch",
  title: "Effect promise .then sets state with no catch",
  severity: "warn",
  category: "Correctness",
  tags: ["test-noise"],
  recommendation:
    "An async init in an effect that sets state in `.then` but has no `.catch` leaves the component stuck and raises an unhandled rejection when it fails. Add a `.catch` on the chain (`.finally` does not handle the rejection).",
  create: (context: RuleContext) => {
    const hasUnmodifiedFetchProvider = createImmediateIifeFetchProviderCheck(context);
    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        const isReactEffect = isReactApiCall(
          node as EsTreeNode,
          new Set(["useEffect", "useLayoutEffect"]),
          context.scopes,
          { allowGlobalReactNamespace: true, allowUnboundBareCalls: true },
        );
        const isImportedUseMount =
          isNodeOfType(node.callee, "Identifier") &&
          node.callee.name === "useMount" &&
          getImportSourceForName(node.callee, node.callee.name) === "react-use";
        if (!isReactEffect && !isImportedUseMount) return;
        const callback = getEffectCallback(node as EsTreeNode);
        if (!isFunctionLike(callback)) return;

        const immediateChains = new Set(
          collectImmediateIifeFloatingChains(node, callback, context),
        );
        for (const chainExpression of [
          ...collectFloatingChains(callback, context),
          ...immediateChains,
        ]) {
          if (
            immediateChains.has(chainExpression) &&
            !hasSupportedImmediateIifeFetchChain(
              chainExpression,
              context,
              hasUnmodifiedFetchProvider,
            )
          ) {
            continue;
          }
          const chainWalk = walkPromiseChain(chainExpression, context);
          if (!chainWalk.sawThen) continue;
          if (chainWalk.hasCatch || chainWalk.hasRejectionHandlerArgument) continue;
          const hasUnguardedStateSideEffect =
            chainWalk.hasDirectSetterThenCallback ||
            chainWalk.thenCallbacks.some((thenCallback) => {
              const sideEffectNodes = collectStateSideEffectNodes(thenCallback, context);
              if (!immediateChains.has(chainExpression)) return sideEffectNodes.length > 0;
              const thenCallbackClass = findEnclosingClass(thenCallback);
              return sideEffectNodes.some(
                (sideEffectNode) =>
                  findEnclosingClass(sideEffectNode) === thenCallbackClass &&
                  isNodeReachableWithinFunction(sideEffectNode, context),
              );
            });
          if (!hasUnguardedStateSideEffect) continue;
          const resolved = resolveRootInitiator(chainWalk.root, context);
          if (resolved.hasUpstreamRejectionHandling) continue;
          if (
            !immediateChains.has(chainExpression) &&
            !isProvablyRejectableExpression(
              resolved.initiator,
              MAX_INITIATOR_RESOLUTION_DEPTH,
              context,
            )
          ) {
            continue;
          }
          context.report({
            node: chainExpression,
            message: immediateChains.has(chainExpression) ? IMMEDIATE_IIFE_MESSAGE : MESSAGE,
          });
        }
      },
    };
  },
});
