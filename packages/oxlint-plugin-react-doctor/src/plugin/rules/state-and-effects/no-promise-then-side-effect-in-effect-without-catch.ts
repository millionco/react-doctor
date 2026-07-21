import { defineRule } from "../../utils/define-rule.js";
import { doNodesCoverEveryPathAfterNode } from "../../utils/do-nodes-cover-every-path-after-node.js";
import { getEffectCallback } from "../../utils/get-effect-callback.js";
import { findGuardingTryStatement } from "../../utils/find-guarding-try-statement.js";
import { getDirectUnreassignedInitializer } from "../../utils/get-direct-unreassigned-initializer.js";
import { getImportSourceForName } from "../../utils/find-import-source-for-name.js";
import { getRangeStart } from "../../utils/get-range-start.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
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
const NON_REJECTING_CONSOLE_METHOD_NAMES = new Set([
  "debug",
  "error",
  "info",
  "log",
  "trace",
  "warn",
]);

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
const isKnownNonThenableHandlerReturn = (
  expression: EsTreeNode,
  context: RuleContext,
  visitedBindingIdentifiers = new Set<EsTreeNode>(),
): boolean => {
  const strippedExpression = stripParenExpression(expression);
  if (isDefinitelyNonThenableValue(strippedExpression)) return true;
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
    initializer && isKnownNonThenableHandlerReturn(initializer, context, visitedBindingIdentifiers),
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
      !isKnownNonThenableHandlerReturn(child.argument, context)
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
    if (isNodeOfType(callee, "MemberExpression")) {
      const receiver = stripParenExpression(callee.object);
      if (
        isNodeOfType(receiver, "Identifier") &&
        receiver.name === "console" &&
        context.scopes.isGlobalReference(receiver) &&
        NON_REJECTING_CONSOLE_METHOD_NAMES.has(getStaticPropertyName(callee) ?? "")
      ) {
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
  const receiver = stripParenExpression(member.object);
  if (!isNodeOfType(receiver, "Identifier") || !context.scopes.isGlobalReference(receiver)) {
    return false;
  }
  const methodName = getStaticPropertyName(member);
  if (receiver.name === "console") {
    return NON_REJECTING_CONSOLE_METHOD_NAMES.has(methodName ?? "");
  }
  return receiver.name === "Promise" && methodName === "resolve";
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
    const hasAbsorbingRejectionHandler =
      !handlerHasPotentiallyThrowingMemberRead(rejectionHandlerArgument, context) &&
      (chainCarriesRejectionHandler(cursor, context.scopes) ||
        isKnownNonRejectingHandler(rejectionHandlerArgument, context));
    if (!didReachTerminalThen && methodName === "catch" && hasAbsorbingRejectionHandler) {
      hasCatch = true;
    }
    if (methodName === "then") {
      if (!didReachTerminalThen && hasAbsorbingRejectionHandler) {
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
export const noPromiseThenSideEffectInEffectWithoutCatch = defineRule({
  id: "no-promise-then-side-effect-in-effect-without-catch",
  title: "Effect promise .then sets state with no catch",
  severity: "warn",
  category: "Correctness",
  tags: ["test-noise"],
  recommendation:
    "An async init in an effect that sets state in `.then` but has no `.catch` leaves the component stuck and raises an unhandled rejection when it fails. Add a `.catch` on the chain (`.finally` does not handle the rejection).",
  create: (context: RuleContext) => ({
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

      for (const chainExpression of collectFloatingChains(callback, context)) {
        const chainWalk = walkPromiseChain(chainExpression, context);
        if (!chainWalk.sawThen) continue;
        if (chainWalk.hasCatch || chainWalk.hasRejectionHandlerArgument) continue;
        const hasUnguardedStateSideEffect =
          chainWalk.hasDirectSetterThenCallback ||
          chainWalk.thenCallbacks.some((thenCallback) => {
            return collectStateSideEffectNodes(thenCallback, context).length > 0;
          });
        if (!hasUnguardedStateSideEffect) continue;
        const resolved = resolveRootInitiator(chainWalk.root, context);
        if (resolved.hasUpstreamRejectionHandling) continue;
        if (
          !isProvablyRejectableExpression(
            resolved.initiator,
            MAX_INITIATOR_RESOLUTION_DEPTH,
            context,
          )
        ) {
          continue;
        }
        context.report({ node: chainExpression, message: MESSAGE });
      }
    },
  }),
});
