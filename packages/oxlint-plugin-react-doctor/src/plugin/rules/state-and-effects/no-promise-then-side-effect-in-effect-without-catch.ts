import { defineRule } from "../../utils/define-rule.js";
import { getEffectCallback } from "../../utils/get-effect-callback.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { isInsideTryStatement } from "../../utils/is-inside-try-statement.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isSetterIdentifier } from "../../utils/is-setter-identifier.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import { walkOwnFunctionScope } from "../../utils/walk-own-function-scope.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";

// Effect-shaped hooks incl. the common userland `useMount`; named distinctly so
// it does not shadow the canonical two-member `EFFECT_HOOK_NAMES`.
const EFFECT_LIKE_HOOK_NAMES = new Set(["useEffect", "useLayoutEffect", "useMount"]);
const PROMISE_METHOD_NAMES = new Set(["then", "catch", "finally"]);
// `Promise.allSettled` never rejects; `resolve`/`reject` are the
// microtask-defer idiom — only these combinators propagate an input
// rejection to the chain.
const REJECTING_PROMISE_COMBINATOR_NAMES = new Set(["all", "race", "any"]);
// Global timer callables that match the `/^set[A-Z]/` state-setter
// pattern but set no React state.
const GLOBAL_TIMER_NAMES = new Set(["setTimeout", "setInterval", "setImmediate"]);
const IMPORT_BINDING_TYPES = new Set([
  "ImportSpecifier",
  "ImportDefaultSpecifier",
  "ImportNamespaceSpecifier",
]);
const MAX_INITIATOR_RESOLUTION_DEPTH = 3;

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

const isReactStateSetterName = (name: string): boolean =>
  isSetterIdentifier(name) && !GLOBAL_TIMER_NAMES.has(name);

// Walks a `.then`/`.catch`/`.finally` member-call chain down to its
// initiator, collecting which settlement methods appear and the
// `.then` callbacks.
const walkPromiseChain = (chainExpression: EsTreeNode): PromiseChainWalk => {
  let cursor = stripParenExpression(chainExpression);
  let hasCatch = false;
  let hasRejectionHandlerArgument = false;
  let sawThen = false;
  let hasDirectSetterThenCallback = false;
  const thenCallbacks: FunctionLikeNode[] = [];

  while (
    isNodeOfType(cursor, "CallExpression") &&
    isNodeOfType(cursor.callee, "MemberExpression") &&
    !cursor.callee.computed &&
    isNodeOfType(cursor.callee.property, "Identifier") &&
    PROMISE_METHOD_NAMES.has(cursor.callee.property.name)
  ) {
    const methodName = cursor.callee.property.name;
    if (methodName === "catch") hasCatch = true;
    if (methodName === "then") {
      sawThen = true;
      if (cursor.arguments.length >= 2) hasRejectionHandlerArgument = true;
      const callbackArgument = cursor.arguments[0];
      const callback = callbackArgument ? stripParenExpression(callbackArgument) : null;
      if (callback && isFunctionLike(callback)) {
        thenCallbacks.push(callback);
      } else if (
        callback &&
        isNodeOfType(callback, "Identifier") &&
        isReactStateSetterName(callback.name)
      ) {
        hasDirectSetterThenCallback = true;
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

// Follows an identifier initiator (`const request = fetch(url); request.then(...)`)
// through its initializer — including an intermediate `.then` chain bound to a
// variable — down to the root expression, remembering whether any hop along the
// way already attached a `.catch`/onRejected handler.
const resolveRootInitiator = (root: EsTreeNode): ResolvedInitiator => {
  let cursor = stripParenExpression(root);
  let hasUpstreamRejectionHandling = false;
  const visitedBindingNames = new Set<string>();
  while (true) {
    const chainWalk = walkPromiseChain(cursor);
    if (chainWalk.root !== cursor) {
      if (chainWalk.hasCatch || chainWalk.hasRejectionHandlerArgument) {
        hasUpstreamRejectionHandling = true;
      }
      cursor = stripParenExpression(chainWalk.root);
      continue;
    }
    if (isNodeOfType(cursor, "Identifier") && !visitedBindingNames.has(cursor.name)) {
      visitedBindingNames.add(cursor.name);
      const binding = findVariableInitializer(cursor, cursor.name);
      if (binding?.initializer && !isFunctionLike(binding.initializer)) {
        cursor = stripParenExpression(binding.initializer);
        continue;
      }
    }
    return { initiator: cursor, hasUpstreamRejectionHandling };
  }
};

// A loaders-map lookup (`loaders[locale]` / `loaders.en`) whose map holds
// function values — the dynamic-import registry idiom. Rejectable when a
// matching entry's function is.
const memberLookupResolvesToRejectableFunction = (
  memberNode: EsTreeNodeOfType<"MemberExpression">,
  remainingDepth: number,
): boolean => {
  const strippedObject = stripParenExpression(memberNode.object);
  const boundInitializer = isNodeOfType(strippedObject, "Identifier")
    ? findVariableInitializer(strippedObject, strippedObject.name)?.initializer
    : null;
  const objectExpression = boundInitializer
    ? stripParenExpression(boundInitializer)
    : strippedObject;
  if (!isNodeOfType(objectExpression, "ObjectExpression")) return false;
  const lookedUpName =
    !memberNode.computed && isNodeOfType(memberNode.property, "Identifier")
      ? memberNode.property.name
      : null;
  return objectExpression.properties.some((property) => {
    if (!isNodeOfType(property, "Property")) return false;
    if (lookedUpName !== null) {
      const keyMatches = isNodeOfType(property.key, "Identifier")
        ? property.key.name === lookedUpName
        : isNodeOfType(property.key, "Literal") && property.key.value === lookedUpName;
      if (!keyMatches) return false;
    }
    const value = stripParenExpression(property.value);
    return isFunctionLike(value) && functionHasUnhandledRejectableSource(value, remainingDepth);
  });
};

// The narrowed initiator contract: only flag when the promise's rejection is
// provable in-file — a dynamic `import()`, a call to the global `fetch`, a
// `Promise.all/race/any` over provable inputs, or a call resolving in-file to
// a function that awaits/returns such a source outside any try/catch. Name
// heuristics (`load*`, `request*`, `x.get()`, …) are gone: in mature codebases
// those wrappers routinely catch internally and resolve null/`{error}`.
const isProvablyRejectableExpression = (
  expression: EsTreeNode,
  remainingDepth: number,
): boolean => {
  const stripped = stripParenExpression(expression);
  if (isNodeOfType(stripped, "ImportExpression")) return true;
  if (isNodeOfType(stripped, "AwaitExpression")) {
    return isProvablyRejectableExpression(stripped.argument, remainingDepth);
  }
  if (!isNodeOfType(stripped, "CallExpression")) return false;
  const callee = stripParenExpression(stripped.callee);
  if (isNodeOfType(callee, "Identifier")) {
    const binding = findVariableInitializer(callee, callee.name);
    const initializer = binding?.initializer ?? null;
    if (
      callee.name === "fetch" &&
      (initializer === null || IMPORT_BINDING_TYPES.has(initializer.type))
    ) {
      return true;
    }
    if (initializer === null || remainingDepth <= 0) return false;
    const strippedInitializer = stripParenExpression(initializer);
    if (isFunctionLike(strippedInitializer)) {
      return functionHasUnhandledRejectableSource(strippedInitializer, remainingDepth - 1);
    }
    if (isNodeOfType(strippedInitializer, "MemberExpression")) {
      return memberLookupResolvesToRejectableFunction(strippedInitializer, remainingDepth - 1);
    }
    return false;
  }
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  if (
    !callee.computed &&
    isNodeOfType(callee.object, "Identifier") &&
    callee.object.name === "Promise" &&
    isNodeOfType(callee.property, "Identifier")
  ) {
    if (!REJECTING_PROMISE_COMBINATOR_NAMES.has(callee.property.name)) return false;
    const combinatorInput = stripped.arguments[0]
      ? stripParenExpression(stripped.arguments[0])
      : null;
    if (!combinatorInput || !isNodeOfType(combinatorInput, "ArrayExpression")) return false;
    return combinatorInput.elements.some((element) => {
      if (!element || isNodeOfType(element, "SpreadElement")) return false;
      const resolvedElement = resolveRootInitiator(element);
      return (
        !resolvedElement.hasUpstreamRejectionHandling &&
        isProvablyRejectableExpression(resolvedElement.initiator, remainingDepth)
      );
    });
  }
  if (remainingDepth > 0) {
    return memberLookupResolvesToRejectableFunction(callee, remainingDepth - 1);
  }
  return false;
};

// True when the function's own body awaits or returns a provably rejectable
// source outside any try/catch — a try-wrapped await means the wrapper folds
// the failure into its resolution value (`resolve null` contract) and the
// chain cannot reject through it.
const functionHasUnhandledRejectableSource = (
  functionNode: FunctionLikeNode,
  remainingDepth: number,
): boolean => {
  let didFindRejectableSource = false;
  const checkCandidate = (candidate: EsTreeNode, positionNode: EsTreeNode): void => {
    if (isInsideTryStatement(positionNode, { boundary: functionNode })) return;
    const chainWalk = walkPromiseChain(stripParenExpression(candidate));
    if (chainWalk.hasCatch || chainWalk.hasRejectionHandlerArgument) return;
    if (isProvablyRejectableExpression(chainWalk.root, remainingDepth)) {
      didFindRejectableSource = true;
    }
  };
  const body = functionNode.body;
  if (body && !isNodeOfType(body, "BlockStatement")) {
    checkCandidate(body, body);
  }
  walkOwnFunctionScope(functionNode, (child: EsTreeNode) => {
    if (didFindRejectableSource) return false;
    if (isNodeOfType(child, "AwaitExpression")) {
      checkCandidate(child.argument, child);
    }
    if (isNodeOfType(child, "ReturnStatement") && child.argument) {
      checkCandidate(child.argument, child);
    }
  });
  return didFindRejectableSource;
};

// A `set*`-named identifier resolving to a plain same-file function
// (`const setDocumentTitle = (title) => { document.title = title; }`) is a
// DOM helper, not React state.
const resolvesToPlainLocalFunction = (callee: EsTreeNodeOfType<"Identifier">): boolean => {
  const binding = findVariableInitializer(callee, callee.name);
  return Boolean(binding?.initializer && isFunctionLike(binding.initializer));
};

const collectStateSideEffectNodes = (callback: EsTreeNode): EsTreeNode[] => {
  const sideEffectNodes: EsTreeNode[] = [];
  walkAst(callback, (child: EsTreeNode) => {
    if (
      isNodeOfType(child, "CallExpression") &&
      isNodeOfType(child.callee, "Identifier") &&
      isReactStateSetterName(child.callee.name) &&
      !resolvesToPlainLocalFunction(child.callee)
    ) {
      sideEffectNodes.push(child);
    }
    if (
      isNodeOfType(child, "AssignmentExpression") &&
      isNodeOfType(child.left, "MemberExpression") &&
      isNodeOfType(child.left.property, "Identifier") &&
      child.left.property.name === "current"
    ) {
      sideEffectNodes.push(child);
    }
  });
  return sideEffectNodes;
};

// The guard test references the resolved param (through negation, member
// reads like `!response.ok` / `!response?.ok`, `||`-combined cancellation
// flags, nullish/emptiness comparisons) — the exact De Morgan spellings of
// the rule's own clean fixtures.
const testReferencesParam = (test: EsTreeNode, paramName: string): boolean => {
  let referencesParam = false;
  walkAst(test, (child: EsTreeNode) => {
    if (referencesParam) return false;
    if (isNodeOfType(child, "Identifier") && child.name === paramName) {
      const parent = child.parent;
      if (
        parent &&
        isNodeOfType(parent, "MemberExpression") &&
        parent.property === child &&
        !parent.computed
      ) {
        return;
      }
      referencesParam = true;
      return false;
    }
  });
  return referencesParam;
};

const isParamNullGuardReturn = (statement: EsTreeNode, paramName: string): boolean => {
  if (!isNodeOfType(statement, "IfStatement")) return false;
  const test = stripParenExpression(statement.test);
  if (!testReferencesParam(test, paramName)) return false;
  const consequent = statement.consequent;
  if (isNodeOfType(consequent, "ReturnStatement")) return true;
  return (
    isNodeOfType(consequent, "BlockStatement") &&
    consequent.body.length > 0 &&
    isNodeOfType(consequent.body[consequent.body.length - 1], "ReturnStatement")
  );
};

const ERROR_FIELD_NAME_PATTERN = /^errors?$/;

const callbackReadsParamError = (callback: EsTreeNode, paramName: string): boolean => {
  let didFindErrorRead = false;
  walkAst(callback, (child: EsTreeNode) => {
    if (didFindErrorRead) return false;
    if (
      isNodeOfType(child, "MemberExpression") &&
      !child.computed &&
      isNodeOfType(child.property, "Identifier") &&
      ERROR_FIELD_NAME_PATTERN.test(child.property.name)
    ) {
      const errorReadObject = stripParenExpression(child.object);
      if (isNodeOfType(errorReadObject, "Identifier") && errorReadObject.name === paramName) {
        didFindErrorRead = true;
      }
    }
    // `const { error } = result` — destructured error folding.
    if (
      isNodeOfType(child, "VariableDeclarator") &&
      isNodeOfType(child.id, "ObjectPattern") &&
      child.init &&
      isNodeOfType(stripParenExpression(child.init as EsTreeNode), "Identifier") &&
      (stripParenExpression(child.init as EsTreeNode) as EsTreeNodeOfType<"Identifier">).name ===
        paramName &&
      (child.id.properties ?? []).some(
        (property) =>
          isNodeOfType(property, "Property") &&
          !property.computed &&
          isNodeOfType(property.key, "Identifier") &&
          ERROR_FIELD_NAME_PATTERN.test(property.key.name),
      )
    ) {
      didFindErrorRead = true;
    }
  });
  return didFindErrorRead;
};

// `({ data, error }) => { if (error) ... }` — an ObjectPattern then-param
// that binds an error field IS the resolve-null contract.
const objectPatternBindsErrorField = (pattern: EsTreeNode): boolean =>
  isNodeOfType(pattern, "ObjectPattern") &&
  (pattern.properties ?? []).some(
    (property) =>
      isNodeOfType(property, "Property") &&
      !property.computed &&
      isNodeOfType(property.key, "Identifier") &&
      ERROR_FIELD_NAME_PATTERN.test(property.key.name),
  );

const hasParamGuardingIfAncestor = (
  node: EsTreeNode,
  callback: EsTreeNode,
  paramName: string,
): boolean => {
  let child: EsTreeNode = node;
  let ancestor: EsTreeNode | null | undefined = node.parent;
  while (ancestor && ancestor !== callback) {
    if (isNodeOfType(ancestor, "IfStatement") && testReferencesParam(ancestor.test, paramName)) {
      return true;
    }
    // `view && setView(view)` — the &&-guard spelling of the same if.
    if (
      isNodeOfType(ancestor, "LogicalExpression") &&
      ancestor.operator === "&&" &&
      ancestor.right === child &&
      testReferencesParam(ancestor.left as EsTreeNode, paramName)
    ) {
      return true;
    }
    child = ancestor;
    ancestor = ancestor.parent ?? null;
  }
  return false;
};

// A callback that null/error-guards its resolved value signals the initiator's
// resolve-null-on-failure contract (`getDataFromService`-style error folding):
// the wrapper never rejects, so demanding a `.catch` would be dead code.
const callbackSignalsResolveNullContract = (
  callback: FunctionLikeNode,
  sideEffectNodes: EsTreeNode[],
): boolean => {
  const firstParam = callback.params[0] ? stripParenExpression(callback.params[0]) : null;
  if (firstParam && objectPatternBindsErrorField(firstParam)) return true;
  if (!firstParam || !isNodeOfType(firstParam, "Identifier")) return false;
  const paramName = firstParam.name;
  if (callbackReadsParamError(callback, paramName)) return true;
  const body = callback.body;
  if (body && isNodeOfType(body, "BlockStatement")) {
    // Guard-clause returns count anywhere in the callback's own scope —
    // `if (!cancelled) { if (!data) return; ... }` nests one block deep.
    let hasGuardReturn = false;
    walkOwnFunctionScope(callback, (statement: EsTreeNode) => {
      if (hasGuardReturn) return false;
      if (isParamNullGuardReturn(statement, paramName)) {
        hasGuardReturn = true;
        return false;
      }
    });
    if (hasGuardReturn) return true;
  }
  return sideEffectNodes.every((sideEffectNode) =>
    hasParamGuardingIfAncestor(sideEffectNode, callback, paramName),
  );
};

// Walk the effect body without descending into nested functions, so the
// candidate chains belong to the effect scope (the `.then` callbacks are
// nested functions and are inspected separately).
const collectFloatingChains = (callback: EsTreeNode): EsTreeNode[] => {
  const chains: EsTreeNode[] = [];
  walkOwnFunctionScope(callback, (child: EsTreeNode) => {
    if (!isNodeOfType(child, "ExpressionStatement")) return;
    let expression = child.expression as EsTreeNode;
    if (isNodeOfType(expression, "UnaryExpression") && expression.operator === "void") {
      expression = expression.argument as EsTreeNode;
    }
    chains.push(stripParenExpression(expression));
  });
  return chains;
};

// Flags a floating promise chain inside a React effect that is started by a
// provably rejectable async source (dynamic import(), global fetch, a
// Promise.all/race/any over such sources, or an in-file function that
// awaits/returns one uncaught), ends in a `.then` performing a state setter or
// ref mutation, and has no `.catch`/rejection handler and no enclosing
// try/catch. `.finally` does not count as handling the rejection. Callbacks
// that null/error-guard their resolved value are skipped — that shape signals
// a wrapper with a resolve-null-on-failure contract.
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
      if (!isHookCall(node as EsTreeNode, EFFECT_LIKE_HOOK_NAMES)) return;
      const callback = getEffectCallback(node as EsTreeNode);
      if (!isFunctionLike(callback)) return;

      for (const chainExpression of collectFloatingChains(callback)) {
        const chainWalk = walkPromiseChain(chainExpression);
        if (!chainWalk.sawThen) continue;
        if (chainWalk.hasCatch || chainWalk.hasRejectionHandlerArgument) continue;
        const hasUnguardedStateSideEffect =
          chainWalk.hasDirectSetterThenCallback ||
          chainWalk.thenCallbacks.some((thenCallback) => {
            const sideEffectNodes = collectStateSideEffectNodes(thenCallback);
            if (sideEffectNodes.length === 0) return false;
            return !callbackSignalsResolveNullContract(thenCallback, sideEffectNodes);
          });
        if (!hasUnguardedStateSideEffect) continue;
        const resolved = resolveRootInitiator(chainWalk.root);
        if (resolved.hasUpstreamRejectionHandling) continue;
        if (!isProvablyRejectableExpression(resolved.initiator, MAX_INITIATOR_RESOLUTION_DEPTH)) {
          continue;
        }
        if (isInsideTryStatement(chainExpression, { boundary: callback })) continue;
        context.report({ node: chainExpression, message: MESSAGE });
      }
    },
  }),
});
