import { analyzeScopes } from "../../semantic/scope-analysis.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import { collectPatternNames } from "../../utils/collect-pattern-names.js";
import { defineRule } from "../../utils/define-rule.js";
import { doNodesCoverEveryPathAfterNode } from "../../utils/do-nodes-cover-every-path-after-node.js";
import { getEffectCallback } from "../../utils/get-effect-callback.js";
import { findExportedValue } from "../../utils/find-exported-value.js";
import { findGuardingTryStatement } from "../../utils/find-guarding-try-statement.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { getDynamicImportReturnedThen } from "../../utils/get-dynamic-import-returned-then.js";
import { getDirectUnreassignedInitializer } from "../../utils/get-direct-unreassigned-initializer.js";
import { getImportSourceForName } from "../../utils/find-import-source-for-name.js";
import { getModuleSpecifierName } from "../../utils/get-module-specifier-name.js";
import { getRangeStart } from "../../utils/get-range-start.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isProvenNonThrowingBuiltInCall } from "../../utils/is-proven-non-throwing-built-in-call.js";
import { isProvenPromiseExpression } from "../../utils/is-proven-promise-expression.js";
import { isProvenUnmodifiedGlobalNamespaceReference } from "../../utils/is-proven-unmodified-global-namespace-reference.js";
import {
  chainCarriesRejectionHandler,
  isDefinitelyNonThenableValue,
} from "../../utils/is-never-rejecting-expression.js";
import { isReactApiCall } from "../../utils/is-react-api-call.js";
import { isReactHookResultReference } from "../../utils/is-react-hook-result-reference.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isSymbolReadOnly } from "../../utils/is-symbol-read-only.js";
import { isWithinAssignmentTarget } from "../../utils/is-within-assignment-target.js";
import { resolveDirectDynamicImportModule } from "../../utils/resolve-direct-dynamic-import-module.js";
import { resolveExactLocalFunction } from "../../utils/resolve-exact-local-function.js";
import { resolveImportedApiReference } from "../../utils/resolve-imported-api-reference.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import { walkOwnFunctionScope } from "../../utils/walk-own-function-scope.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";

const PROMISE_METHOD_NAMES = new Set(["then", "catch", "finally"]);
const REJECTING_PROMISE_COMBINATOR_NAMES = new Set(["all", "race", "any"]);
const MAX_INITIATOR_RESOLUTION_DEPTH = 3;
const STATE_DISPATCHER_HOOK_NAMES = new Set(["useState", "useReducer"]);
const REF_HOOK_NAMES = new Set(["useRef"]);
const PROMISE_REALM_NAMES = new Set(["globalThis", "global", "window", "self", "document"]);
const PROMISE_REFLECTION_NAMESPACE_NAMES = new Set(["Object", "Reflect"]);
const OPAQUE_PROMISE_PROPERTY_NAMES = new Set([
  "Promise",
  "constructor",
  "prototype",
  "__proto__",
  "defaultView",
  "eval",
  "Function",
  "getPrototypeOf",
  "setPrototypeOf",
  "defineProperty",
  "defineProperties",
]);
const closedPromiseMethodsByScope = new WeakMap<ScopeAnalysis, boolean>();
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

const walkPromiseChain = (
  chainExpression: EsTreeNode,
  context: RuleContext,
  inspectEarlierHandlers = false,
): PromiseChainWalk => {
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
      (!didReachTerminalThen || inspectEarlierHandlers) &&
      methodName === "catch" &&
      hasRejectionHandler(cursor, rejectionHandlerArgument, context, true)
    ) {
      hasCatch = true;
    }
    if (methodName === "then") {
      if (
        (!didReachTerminalThen || inspectEarlierHandlers) &&
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

const isReadonlyStateDispatch = (setter: EsTreeNode, context: RuleContext): boolean => {
  const symbol = context.scopes.symbolFor(setter);
  if (
    !symbol ||
    symbol.kind !== "const" ||
    !isSymbolReadOnly(symbol) ||
    !isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
    !isNodeOfType(symbol.declarationNode.id, "ArrayPattern") ||
    symbol.declarationNode.id.elements[1] !== symbol.bindingIdentifier
  ) {
    return false;
  }
  if (isReactHookResultReference(setter, STATE_DISPATCHER_HOOK_NAMES, 1, context.scopes)) {
    return true;
  }
  const initializer = symbol.declarationNode.init;
  const call = initializer ? stripParenExpression(initializer) : null;
  if (!isNodeOfType(call, "CallExpression") || call.optional) return false;
  const callee = stripParenExpression(call.callee);
  if (!isNodeOfType(callee, "Identifier")) return false;
  const hookSymbol = context.scopes.symbolFor(callee);
  if (
    !hookSymbol ||
    !isNodeOfType(hookSymbol.declarationNode, "ImportSpecifier") ||
    !isSymbolReadOnly(hookSymbol)
  ) {
    return false;
  }
  const hook = resolveImportedApiReference(callee, context.scopes);
  return hook?.source === "jotai" && hook.importedName === "useAtom";
};

const hasClosedPromiseMethods = (scopes: ScopeAnalysis): boolean => {
  const cachedResult = closedPromiseMethodsByScope.get(scopes);
  if (cachedResult !== undefined) return cachedResult;
  let isClosed = true;
  walkAst(scopes.rootScope.node, (node) => {
    if (!isClosed) return false;
    if (isNodeOfType(node, "WithStatement")) {
      isClosed = false;
      return false;
    }
    if (isNodeOfType(node, "CallExpression") && !node.optional) {
      const callee = stripParenExpression(node.callee);
      if (isNodeOfType(callee, "Identifier") && callee.name === "eval") {
        isClosed = false;
        return false;
      }
    }
    if (isNodeOfType(node, "Identifier") && scopes.isGlobalReference(node)) {
      if (
        node.name === "eval" ||
        node.name === "Function" ||
        (node.name === "Promise" &&
          !isProvenUnmodifiedGlobalNamespaceReference(node, "Promise", scopes, undefined, true))
      ) {
        isClosed = false;
      } else if (
        PROMISE_REALM_NAMES.has(node.name) ||
        PROMISE_REFLECTION_NAMESPACE_NAMES.has(node.name)
      ) {
        const receiver = findTransparentExpressionRoot(node);
        const member = receiver.parent;
        if (
          !isNodeOfType(member, "MemberExpression") ||
          member.object !== receiver ||
          getStaticPropertyName(member) === null ||
          (PROMISE_REALM_NAMES.has(node.name) &&
            PROMISE_REFLECTION_NAMESPACE_NAMES.has(getStaticPropertyName(member) ?? ""))
        ) {
          isClosed = false;
        }
      }
      return;
    }
    if (isNodeOfType(node, "MemberExpression")) {
      const name = getStaticPropertyName(node);
      if (
        OPAQUE_PROMISE_PROPERTY_NAMES.has(name ?? "") ||
        (name !== null && PROMISE_METHOD_NAMES.has(name) && isWithinAssignmentTarget(node))
      ) {
        isClosed = false;
      }
    }
  });
  closedPromiseMethodsByScope.set(scopes, isClosed);
  return isClosed;
};

const hasPossibleModuleThenExport = (program: EsTreeNodeOfType<"Program">): boolean =>
  program.body.some((statement) => {
    if (isNodeOfType(statement, "ExportAllDeclaration")) {
      return (
        statement.exportKind !== "type" &&
        (!statement.exported || getModuleSpecifierName(statement.exported) === "then")
      );
    }
    if (isNodeOfType(statement, "TSExportAssignment")) return true;
    if (!isNodeOfType(statement, "ExportNamedDeclaration") || statement.exportKind === "type") {
      return false;
    }
    if (
      statement.specifiers.some(
        (specifier) =>
          specifier.exportKind !== "type" && getModuleSpecifierName(specifier.exported) === "then",
      )
    ) {
      return true;
    }
    const declaration = statement.declaration;
    if (isNodeOfType(declaration, "VariableDeclaration")) {
      const names = new Set<string>();
      for (const declarator of declaration.declarations) collectPatternNames(declarator.id, names);
      return names.has("then");
    }
    return Boolean(
      declaration && "id" in declaration && getModuleSpecifierName(declaration.id) === "then",
    );
  });

const isReadonlyAsyncExport = (
  filename: string,
  specifier: string,
  exportedName: string,
): boolean => {
  const program = resolveDirectDynamicImportModule(filename, specifier);
  if (!program || hasPossibleModuleThenExport(program)) return false;
  const exported = findExportedValue(program, exportedName);
  if (
    !isNodeOfType(exported, "FunctionDeclaration") ||
    !exported.async ||
    exported.generator ||
    exported.id?.name !== exportedName ||
    !isNodeOfType(exported.parent, "ExportNamedDeclaration")
  ) {
    return false;
  }
  const exportScopes = analyzeScopes(program);
  const binding = exportScopes.scopeFor(exported).symbolsByName.get(exportedName);
  const functionBinding = exportScopes.ownScopeFor(exported)?.symbolsByName.get(exportedName);
  return Boolean(
    binding &&
    binding.declarationNode === exported &&
    isSymbolReadOnly(binding) &&
    functionBinding?.declarationNode === exported &&
    isSymbolReadOnly(functionBinding) &&
    hasClosedPromiseMethods(exportScopes),
  );
};

const hasReturnedImportStateDispatch = (
  callback: EsTreeNode,
  importer: EsTreeNode,
  context: RuleContext,
): boolean => {
  const parent = findTransparentExpressionRoot(callback).parent;
  const candidate = parent ? getDynamicImportReturnedThen(parent) : null;
  if (
    !candidate ||
    candidate.importer !== importer ||
    !isReadonlyStateDispatch(candidate.setter, context) ||
    !hasClosedPromiseMethods(context.scopes)
  ) {
    return false;
  }
  if (
    isProvenPromiseExpression(candidate.returned, context.scopes, {
      requireUnmodifiedGlobalPromise: true,
    })
  ) {
    return true;
  }
  const imported = candidate.exportedCall;
  if (!imported || !context.filename) return false;
  const binding = context.scopes.symbolFor(imported.callee);
  return Boolean(
    binding &&
    binding.kind === "parameter" &&
    binding.bindingIdentifier === imported.binding &&
    isSymbolReadOnly(binding) &&
    isReadonlyAsyncExport(context.filename, imported.specifier, imported.exportedName),
  );
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
        if (!hasUnguardedStateSideEffect) {
          const importer = stripParenExpression(chainWalk.root);
          if (
            !isNodeOfType(importer, "ImportExpression") ||
            !chainWalk.thenCallbacks.some((thenCallback) =>
              hasReturnedImportStateDispatch(thenCallback, importer, context),
            )
          ) {
            continue;
          }
          const outerHandlers = walkPromiseChain(chainExpression, context, true);
          if (outerHandlers.hasCatch || outerHandlers.hasRejectionHandlerArgument) continue;
        }
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
