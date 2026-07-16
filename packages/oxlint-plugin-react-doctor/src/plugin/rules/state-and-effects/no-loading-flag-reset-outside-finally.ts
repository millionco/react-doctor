import { defineRule } from "../../utils/define-rule.js";
import {
  chainCarriesRejectionHandler,
  isInsideNonRethrowingTry,
  isNeverRejectingHelperCall,
  isNonRejectingPromiseConstruction,
  isPromiseResolveCall,
  subtreeContainsThrow,
} from "../../utils/is-never-rejecting-expression.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { getImportBindingForName } from "../../utils/find-import-source-for-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { ResolvedCrossFileExport } from "../../utils/resolve-cross-file-export.js";
import { resolveCrossFileExport } from "../../utils/resolve-cross-file-export.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import { walkOwnFunctionScope } from "../../utils/walk-own-function-scope.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { RuleVisitors } from "../../utils/rule-visitors.js";
import { unwrapChainExpression } from "./utils/unwrap-chain-expression.js";

const MESSAGE =
  "This resets a loading/busy flag only on the success path: if the awaited call rejects the reset never runs and the flag stays stuck truthy (a spinner that never stops, a button disabled forever). Move the reset into a `finally` block, or mirror it on every catch, so it clears on rejection too.";

// A stuck flag in jest/vitest fixture components fails the test run instead
// of stranding a user on a spinner, so test files are out of scope.
const TEST_FILE_BASENAME_SUFFIXES: ReadonlyArray<string> = [".test.", ".spec.", ".cy."];

const TEST_FILE_PATH_SEGMENTS: ReadonlyArray<string> = [
  "/__tests__/",
  "/__test__/",
  "/__mocks__/",
  "/tests/",
  "/test/",
];

const isTestFileFilename = (rawFilename: string | undefined): boolean => {
  if (!rawFilename) return false;
  const filename = rawFilename.replaceAll("\\", "/");
  const lastSlash = filename.lastIndexOf("/");
  const basename = lastSlash === -1 ? filename : filename.slice(lastSlash + 1);
  if (TEST_FILE_BASENAME_SUFFIXES.some((suffix) => basename.includes(suffix))) return true;
  const rootedFilename = filename.startsWith("/") ? filename : `/${filename}`;
  return TEST_FILE_PATH_SEGMENTS.some((segment) => rootedFilename.includes(segment));
};

const LOADING_FLAG_SETTER_PATTERN =
  /(loading|busy|submitting|saving|pending|fetching|processing|uploading|spinner|disabl|refreshing|updating|inflight|working|posting|sending|deleting)/i;

// Property names that mark the awaited call as a never-rejecting result-object
// wrapper (`const result = await f(); if (result.success) ...`) — errors are
// folded into the resolved value, so the await cannot skip the trailing reset.
const RESULT_SHAPE_PROPERTY_NAMES = new Set(["success", "error", "ok", "data"]);

// Array methods whose callback receives each element of the awaited result,
// so `<results>.filter((entry) => !entry.success)` is a per-element result-shape
// check equivalent to `if (result.success)` on a single awaited binding.
const ARRAY_CALLBACK_METHOD_NAMES = new Set([
  "filter",
  "map",
  "flatMap",
  "some",
  "every",
  "find",
  "forEach",
]);

const getNodeStart = (node: EsTreeNode): number | null => {
  const start = (node as { start?: unknown }).start;
  return typeof start === "number" ? start : null;
};

const getNodeEnd = (node: EsTreeNode): number | null => {
  const end = (node as { end?: unknown }).end;
  return typeof end === "number" ? end : null;
};

// The boolean argument of a `setX(true)` / `setX(false)` call, or null when
// the call is not a bare-identifier setter with a boolean-literal first arg.
const getSetterBooleanValue = (
  node: EsTreeNodeOfType<"CallExpression">,
): { setterName: string; value: boolean } | null => {
  if (!isNodeOfType(node.callee, "Identifier")) return null;
  const firstArgument = node.arguments[0];
  if (!firstArgument || !isNodeOfType(firstArgument, "Literal")) return null;
  if (typeof firstArgument.value !== "boolean") return null;
  return { setterName: node.callee.name, value: firstArgument.value };
};

// Where a call sits relative to the enclosing async function's try/catch:
// inside a `finally` finalizer, inside a `catch` handler, or neither
// ("plain" — a trailing success-path statement or a bare try body).
const classifyResetContext = (
  callNode: EsTreeNode,
  functionNode: EsTreeNode,
): "finally" | "catch" | "plain" => {
  let child: EsTreeNode = callNode;
  let cursor: EsTreeNode | null | undefined = callNode.parent;
  while (cursor && cursor !== functionNode) {
    if (isNodeOfType(cursor, "CatchClause")) return "catch";
    if (isNodeOfType(cursor, "TryStatement") && cursor.finalizer === child) return "finally";
    child = cursor;
    cursor = cursor.parent ?? null;
  }
  return "plain";
};

// Depth budget for the recursive never-rejecting analysis (helper calls
// resolving to helpers, Promise.all over pushed arrays); bounds mutual
// recursion through same-file bindings.
const NEVER_REJECTING_ANALYSIS_MAX_DEPTH = 3;

const REDUX_DISPATCH_CALLEE_NAME_PATTERN = /dispatch$/i;

// `await dispatch(saveThing(...))` — Redux Toolkit `createAsyncThunk`
// dispatches resolve with a rejected ACTION instead of throwing; rejection
// only surfaces through `.unwrap()`, a member chain this bare-dispatch
// shape does not match, so `.unwrap()`ed dispatches stay flagged.
const isThunkActionDispatchCall = (callNode: EsTreeNodeOfType<"CallExpression">): boolean => {
  const callee = stripParenExpression(callNode.callee);
  if (!isNodeOfType(callee, "Identifier")) return false;
  if (!REDUX_DISPATCH_CALLEE_NAME_PATTERN.test(callee.name)) return false;
  const firstArgument = callNode.arguments[0];
  return (
    Boolean(firstArgument) && isNodeOfType(stripParenExpression(firstArgument), "CallExpression")
  );
};

const getUseCallbackWrappedFunction = (expression: EsTreeNode): EsTreeNode => {
  const stripped = stripParenExpression(expression);
  if (!isNodeOfType(stripped, "CallExpression")) return stripped;
  const callee = stripParenExpression(stripped.callee);
  const calleeName = isNodeOfType(callee, "Identifier")
    ? callee.name
    : isNodeOfType(callee, "MemberExpression") &&
        !callee.computed &&
        isNodeOfType(callee.property, "Identifier")
      ? callee.property.name
      : null;
  if (calleeName !== "useCallback") return stripped;
  const wrappedFunction = stripped.arguments[0];
  return wrappedFunction && isFunctionLike(wrappedFunction) ? wrappedFunction : stripped;
};

// `await Promise.all(sharingPromises)` where the binding is an array literal
// whose elements — and every `<name>.push(...)` into it in the same scope —
// are never-rejecting promises (e.g. RTK dispatches). Any reassignment of
// the binding makes its contents unknowable and bails out.
const isArrayBindingOfNeverRejectingPromises = (
  identifier: EsTreeNodeOfType<"Identifier">,
  depth: number,
): boolean => {
  if (depth <= 0) return false;
  const binding = findVariableInitializer(identifier, identifier.name);
  if (!binding?.initializer) return false;
  const initializer = stripParenExpression(binding.initializer);
  if (!isNodeOfType(initializer, "ArrayExpression")) return false;
  if (
    !initializer.elements.every(
      (element) => element !== null && isNeverRejectingExpression(element, depth - 1),
    )
  ) {
    return false;
  }
  let isRejectionProof = true;
  walkAst(binding.scopeOwner, (child: EsTreeNode) => {
    if (!isRejectionProof) return false;
    if (isNodeOfType(child, "AssignmentExpression")) {
      const target = child.left;
      if (isNodeOfType(target, "Identifier") && target.name === identifier.name) {
        isRejectionProof = false;
        return false;
      }
      return;
    }
    if (!isNodeOfType(child, "CallExpression")) return;
    const callee = child.callee;
    if (!isNodeOfType(callee, "MemberExpression") || callee.computed) return;
    if (!isNodeOfType(callee.property, "Identifier") || callee.property.name !== "push") return;
    const receiver = stripParenExpression(callee.object);
    if (!isNodeOfType(receiver, "Identifier") || receiver.name !== identifier.name) return;
    if (
      !(child.arguments ?? []).every((argument) => isNeverRejectingExpression(argument, depth - 1))
    ) {
      isRejectionProof = false;
      return false;
    }
  });
  return isRejectionProof;
};

const getPromiseCombinatorMethodName = (
  callNode: EsTreeNodeOfType<"CallExpression">,
): string | null => {
  const callee = stripParenExpression(callNode.callee);
  if (!isNodeOfType(callee, "MemberExpression") || callee.computed) return null;
  if (!isNodeOfType(callee.object, "Identifier") || callee.object.name !== "Promise") return null;
  return isNodeOfType(callee.property, "Identifier") ? callee.property.name : null;
};

// `Promise.allSettled(...)` never rejects by spec; `Promise.all(...)` never
// rejects when every member provably never rejects (inline `.catch`
// fallbacks per element, or an array binding populated with dispatches).
const isNeverRejectingPromiseCombinatorCall = (
  callNode: EsTreeNodeOfType<"CallExpression">,
  depth: number,
): boolean => {
  const methodName = getPromiseCombinatorMethodName(callNode);
  if (methodName === "allSettled") return true;
  if (methodName !== "all") return false;
  const argument = callNode.arguments[0];
  if (!argument) return false;
  const stripped = stripParenExpression(argument);
  if (isNodeOfType(stripped, "ArrayExpression")) {
    return stripped.elements.every(
      (element) => element !== null && isNeverRejectingExpression(element, depth),
    );
  }
  if (isNodeOfType(stripped, "Identifier")) {
    return isArrayBindingOfNeverRejectingPromises(stripped, depth);
  }
  return false;
};

const SYNC_ARRAY_METHOD_NAMES = new Set([
  "sort",
  "map",
  "filter",
  "flatMap",
  "some",
  "every",
  "find",
  "findIndex",
  "forEach",
  "slice",
  "concat",
  "join",
  "reduce",
  "includes",
  "indexOf",
  "reverse",
  "flat",
  "toSorted",
  "toReversed",
]);

// `return [...source].sort(comparator)` — an Array.prototype method called on
// an array literal returns a plain array (never a thenable), so an async
// helper returning it cannot adopt a rejecting promise; throw-free callback
// arguments rule out the one sync escape (a throwing comparator).
const isSyncArrayLiteralMethodCall = (callNode: EsTreeNodeOfType<"CallExpression">): boolean => {
  const callee = stripParenExpression(callNode.callee);
  if (!isNodeOfType(callee, "MemberExpression") || callee.computed) return false;
  if (!isNodeOfType(callee.property, "Identifier")) return false;
  if (!SYNC_ARRAY_METHOD_NAMES.has(callee.property.name)) return false;
  const receiver = stripParenExpression(callee.object);
  if (!isNodeOfType(receiver, "ArrayExpression")) return false;
  return (callNode.arguments ?? []).every((argument) => !subtreeContainsThrow(argument));
};

const returnedExpressionCanReject = (expression: EsTreeNode, depth: number): boolean => {
  const returned = stripParenExpression(expression);
  if (isNodeOfType(returned, "CallExpression")) {
    if (isSyncArrayLiteralMethodCall(returned)) return false;
    return !isNeverRejectingExpression(returned, depth);
  }
  if (isNodeOfType(returned, "NewExpression")) {
    const isPromiseConstruction =
      isNodeOfType(returned.callee, "Identifier") && returned.callee.name === "Promise";
    return isPromiseConstruction && !isNonRejectingPromiseConstruction(returned);
  }
  return false;
};

// `await this.method(...)` in a class component — the method body lives in
// the same class, so its rejection-proofness is provable in-file.
const findEnclosingClassMethodFunction = (
  referenceNode: EsTreeNode,
  methodName: string,
): EsTreeNode | null => {
  let cursor: EsTreeNode | null | undefined = referenceNode.parent;
  while (cursor) {
    if (isNodeOfType(cursor, "ClassBody")) {
      for (const member of cursor.body) {
        if (
          !isNodeOfType(member, "MethodDefinition") &&
          !isNodeOfType(member, "PropertyDefinition")
        )
          continue;
        if (member.computed) continue;
        if (!isNodeOfType(member.key, "Identifier") || member.key.name !== methodName) continue;
        const memberValue = member.value;
        return memberValue && isFunctionLike(memberValue) ? memberValue : null;
      }
      return null;
    }
    cursor = cursor.parent ?? null;
  }
  return null;
};

const resolveSameFileHelperFunction = (
  callNode: EsTreeNodeOfType<"CallExpression">,
): EsTreeNode | null => {
  const callee = stripParenExpression(callNode.callee);
  if (isNodeOfType(callee, "Identifier")) {
    const binding = findVariableInitializer(callee, callee.name);
    if (!binding?.initializer) return null;
    return getUseCallbackWrappedFunction(binding.initializer);
  }
  if (
    isNodeOfType(callee, "MemberExpression") &&
    !callee.computed &&
    isNodeOfType(callee.object, "ThisExpression") &&
    isNodeOfType(callee.property, "Identifier")
  ) {
    return findEnclosingClassMethodFunction(callNode, callee.property.name);
  }
  return null;
};

// The body analysis shared by same-file and imported helpers: every await
// is itself never-rejecting or sits in a try with a non-rethrowing catch,
// with no unguarded throw and no returned call that could reject.
const isRejectionProofAsyncHelperBody = (helper: EsTreeNode, depth: number): boolean => {
  let isRejectionProof = true;
  walkOwnFunctionScope(helper, (child: EsTreeNode) => {
    if (!isRejectionProof) return false;
    if (isNodeOfType(child, "AwaitExpression")) {
      const awaited = child.argument ? stripParenExpression(child.argument) : null;
      const isSafeAwait =
        (awaited !== null && isNeverRejectingExpression(awaited, depth - 1)) ||
        isInsideNonRethrowingTry(child, helper);
      if (!isSafeAwait) isRejectionProof = false;
      return;
    }
    if (isNodeOfType(child, "ThrowStatement")) {
      if (!isInsideNonRethrowingTry(child, helper)) isRejectionProof = false;
      return;
    }
    if (isNodeOfType(child, "ReturnStatement") && child.argument) {
      if (returnedExpressionCanReject(child.argument, depth - 1)) isRejectionProof = false;
    }
  });
  if (
    isNodeOfType(helper, "ArrowFunctionExpression") &&
    !isNodeOfType(helper.body, "BlockStatement") &&
    returnedExpressionCanReject(helper.body, depth - 1)
  ) {
    isRejectionProof = false;
  }
  return isRejectionProof;
};

// Cross-file resolutions per linted file are capped: oxc-resolver +
// re-parsing foreign modules is filesystem work, and one stuck-flag proof
// rarely needs more than a couple of imported helpers.
const CROSS_FILE_RESOLUTION_BUDGET_PER_FILE = 3;

// Per-file cross-file analysis state, reset in `create` before each lint.
// The absolute filename anchors import resolution (undefined / relative
// filenames make every cross-file lookup a no-op, mirroring
// no-mutating-reducer-state's convention); the memo keeps repeated awaits
// of the same import from re-consuming the resolution budget.
let currentLintedFilename: string | undefined;
let crossFileResolutionsRemaining = 0;
const crossFileResolutionMemo = new Map<string, ResolvedCrossFileExport | null>();

// Foreign helpers must be self-contained proofs: while their body is being
// analyzed, further cross-file hops are disabled, so an opaque imported
// call INSIDE the foreign body stays unproven (no transitive proof chains).
let isAnalyzingForeignHelperBody = false;

const resolveCrossFileExportWithinBudget = (
  specifier: string,
  exportedName: string,
): ResolvedCrossFileExport | null => {
  if (!currentLintedFilename) return null;
  const memoKey = `${specifier}\u0000${exportedName}`;
  const memoized = crossFileResolutionMemo.get(memoKey);
  if (memoized !== undefined) return memoized;
  if (crossFileResolutionsRemaining <= 0) return null;
  crossFileResolutionsRemaining -= 1;
  const resolved = resolveCrossFileExport(currentLintedFilename, specifier, exportedName);
  crossFileResolutionMemo.set(memoKey, resolved);
  return resolved;
};

const isRejectionProofForeignHelperBody = (helper: EsTreeNode, depth: number): boolean => {
  isAnalyzingForeignHelperBody = true;
  try {
    return isRejectionProofAsyncHelperBody(helper, depth);
  } finally {
    isAnalyzingForeignHelperBody = false;
  }
};

// `await uploadFiles(...)` where `uploadFiles` is a NAMED import: resolve
// the export in its source module (following barrel re-exports and renamed
// imports) and run the same never-rejecting body analysis on the foreign
// function. The resolved node may be the function itself or a const
// initializer wrapping useCallback / an arrow.
const isNeverRejectingImportedAsyncHelperCall = (
  callee: EsTreeNodeOfType<"Identifier">,
  depth: number,
): boolean => {
  const importBinding = getImportBindingForName(callee, callee.name);
  if (!importBinding || importBinding.isNamespace || !importBinding.exportedName) return false;
  const resolved = resolveCrossFileExportWithinBudget(
    importBinding.source,
    importBinding.exportedName,
  );
  if (!resolved) return false;
  const foreignHelper = getUseCallbackWrappedFunction(resolved.node);
  if (!isFunctionLike(foreignHelper) || !foreignHelper.async) return false;
  return isRejectionProofForeignHelperBody(foreignHelper, depth);
};

// The object literal a hook returns: a direct `return {...}` (or arrow
// expression body), possibly wrapped in `useMemo(() => ({...}), deps)`.
const getHookReturnedObjectExpression = (
  hookFunction: EsTreeNode,
): EsTreeNodeOfType<"ObjectExpression"> | null => {
  const unwrapReturnedExpression = (expression: EsTreeNode): EsTreeNode | null => {
    const stripped = stripParenExpression(expression);
    if (isNodeOfType(stripped, "ObjectExpression")) return stripped;
    if (!isNodeOfType(stripped, "CallExpression")) return null;
    const memoCallee = stripParenExpression(stripped.callee);
    if (!isNodeOfType(memoCallee, "Identifier") || memoCallee.name !== "useMemo") return null;
    const memoFactory = stripped.arguments[0];
    if (!isFunctionLike(memoFactory)) return null;
    if (!isNodeOfType(memoFactory.body, "BlockStatement")) {
      return unwrapReturnedExpression(memoFactory.body);
    }
    let factoryReturned: EsTreeNode | null = null;
    walkOwnFunctionScope(memoFactory, (child: EsTreeNode) => {
      if (factoryReturned) return false;
      if (isNodeOfType(child, "ReturnStatement") && child.argument) {
        factoryReturned = unwrapReturnedExpression(child.argument);
      }
    });
    return factoryReturned;
  };

  if (!isFunctionLike(hookFunction)) return null;
  if (!isNodeOfType(hookFunction.body, "BlockStatement")) {
    const returned = unwrapReturnedExpression(hookFunction.body);
    return returned && isNodeOfType(returned, "ObjectExpression") ? returned : null;
  }
  let returnedObject: EsTreeNodeOfType<"ObjectExpression"> | null = null;
  walkOwnFunctionScope(hookFunction, (child: EsTreeNode) => {
    if (returnedObject) return false;
    if (!isNodeOfType(child, "ReturnStatement") || !child.argument) return;
    const returned = unwrapReturnedExpression(child.argument);
    if (returned && isNodeOfType(returned, "ObjectExpression")) returnedObject = returned;
  });
  return returnedObject;
};

// The function bound to `propertyName` in the hook's returned object: the
// property value is either the function itself or an identifier resolving
// (within the hook's own file) to one, possibly useCallback-wrapped.
const resolveHookReturnedFunctionProperty = (
  returnedObject: EsTreeNodeOfType<"ObjectExpression">,
  propertyName: string,
): EsTreeNode | null => {
  for (const property of returnedObject.properties) {
    if (!isNodeOfType(property, "Property") || property.computed) continue;
    const keyName = isNodeOfType(property.key, "Identifier")
      ? property.key.name
      : isNodeOfType(property.key, "Literal") && typeof property.key.value === "string"
        ? property.key.value
        : null;
    if (keyName !== propertyName) continue;
    const value = stripParenExpression(property.value as EsTreeNode);
    if (isFunctionLike(value)) return value;
    if (!isNodeOfType(value, "Identifier")) return null;
    const binding = findVariableInitializer(value, value.name);
    if (!binding?.initializer) return null;
    return getUseCallbackWrappedFunction(binding.initializer);
  }
  return null;
};

const HOOK_NAME_PATTERN = /^use[A-Z0-9]/;

// `const { annotate } = useMediaAnnotations()` where the hook is a NAMED
// import: resolve the hook function cross-file, find the matching function
// property in its returned object literal, and run the same never-rejecting
// body analysis on it.
const isNeverRejectingImportedHookFunctionCall = (
  callee: EsTreeNodeOfType<"Identifier">,
  depth: number,
): boolean => {
  const binding = findVariableInitializer(callee, callee.name);
  if (!binding || binding.initializer) return false;
  const destructuredProperty = binding.bindingIdentifier.parent;
  if (!isNodeOfType(destructuredProperty, "Property")) return false;
  if (destructuredProperty.computed) return false;
  if (!isNodeOfType(destructuredProperty.key, "Identifier")) return false;
  const propertyName = destructuredProperty.key.name;
  const objectPattern = destructuredProperty.parent;
  if (!objectPattern || !isNodeOfType(objectPattern, "ObjectPattern")) return false;
  const declarator = objectPattern.parent;
  if (!declarator || !isNodeOfType(declarator, "VariableDeclarator")) return false;
  if (declarator.id !== objectPattern || !declarator.init) return false;
  const hookCall = stripParenExpression(declarator.init);
  if (!isNodeOfType(hookCall, "CallExpression")) return false;
  const hookCallee = stripParenExpression(hookCall.callee);
  if (!isNodeOfType(hookCallee, "Identifier")) return false;
  if (!HOOK_NAME_PATTERN.test(hookCallee.name)) return false;
  const hookImportBinding = getImportBindingForName(hookCallee, hookCallee.name);
  if (!hookImportBinding || hookImportBinding.isNamespace || !hookImportBinding.exportedName) {
    return false;
  }
  const resolved = resolveCrossFileExportWithinBudget(
    hookImportBinding.source,
    hookImportBinding.exportedName,
  );
  if (!resolved) return false;
  const hookFunction = getUseCallbackWrappedFunction(resolved.node);
  const returnedObject = getHookReturnedObjectExpression(hookFunction);
  if (!returnedObject) return false;
  const returnedFunction = resolveHookReturnedFunctionProperty(returnedObject, propertyName);
  if (!returnedFunction || !isFunctionLike(returnedFunction) || !returnedFunction.async) {
    return false;
  }
  return isRejectionProofForeignHelperBody(returnedFunction, depth);
};

// A never-rejecting async helper call, resolved same-file (possibly
// useCallback-wrapped, or a `this.method` on the enclosing class) or
// cross-file (a named import, or a function destructured from an imported
// hook's returned object). Covers shapes the shared
// isNeverRejectingHelperCall misses: `.catch`-guarded awaits inside the
// helper, useCallback wrappers, class methods, Promise.all over
// dispatch-populated arrays, and imported helpers whose proof lives in
// another module.
const isNeverRejectingLocalAsyncHelperCall = (
  callNode: EsTreeNodeOfType<"CallExpression">,
  depth: number,
): boolean => {
  if (depth <= 0) return false;
  const helper = resolveSameFileHelperFunction(callNode);
  if (helper && isFunctionLike(helper)) {
    return Boolean(helper.async) && isRejectionProofAsyncHelperBody(helper, depth);
  }
  if (isAnalyzingForeignHelperBody) return false;
  const callee = stripParenExpression(callNode.callee);
  if (!isNodeOfType(callee, "Identifier")) return false;
  if (helper && isNodeOfType(helper, "ImportSpecifier")) {
    return isNeverRejectingImportedAsyncHelperCall(callee, depth);
  }
  if (helper) return false;
  return isNeverRejectingImportedHookFunctionCall(callee, depth);
};

const isNeverRejectingExpression = (expression: EsTreeNode, depth: number): boolean => {
  const inner = stripParenExpression(expression);
  if (isNonRejectingPromiseConstruction(inner)) return true;
  if (!isNodeOfType(inner, "CallExpression")) return false;
  if (isPromiseResolveCall(inner)) return true;
  if (isThunkActionDispatchCall(inner)) return true;
  if (chainCarriesRejectionHandler(inner)) return true;
  if (isNeverRejectingPromiseCombinatorCall(inner, depth)) return true;
  if (isNeverRejectingHelperCall(inner)) return true;
  return isNeverRejectingLocalAsyncHelperCall(inner, depth);
};

// `await Promise.allSettled(...)` never rejects by spec, `await f().catch(...)`
// handles rejection inline, `await dispatch(thunk(...))` folds rejection into
// the resolved action, and a provably never-rejecting same-file helper cannot
// skip the trailing reset — the await always resumes.
const isNeverRejectingAwaitedExpression = (
  awaitNode: EsTreeNodeOfType<"AwaitExpression">,
): boolean => {
  const awaited = awaitNode.argument;
  if (!awaited) return false;
  return isNeverRejectingExpression(awaited, NEVER_REJECTING_ANALYSIS_MAX_DEPTH);
};

const isWithinIfTest = (node: EsTreeNode, functionNode: EsTreeNode): boolean => {
  let child: EsTreeNode = node;
  let cursor: EsTreeNode | null | undefined = node.parent;
  while (cursor && cursor !== functionNode) {
    if (isNodeOfType(cursor, "IfStatement")) return cursor.test === child;
    // `setStatus(error ? error.message : "Saved")` — a ternary test checks
    // the result exactly like an if test.
    if (isNodeOfType(cursor, "ConditionalExpression") && cursor.test === child) return true;
    if (isNodeOfType(cursor, "ConditionalExpression")) return false;
    if (isFunctionLike(cursor)) return false;
    child = cursor;
    cursor = cursor.parent ?? null;
  }
  return false;
};

// `fetchUsers.fulfilled.match(action)` — the RTK result check reads the
// awaited binding as a call argument, not through a test position.
const isMatchCallArgument = (node: EsTreeNode): boolean => {
  const parent = node.parent;
  return Boolean(
    parent &&
    isNodeOfType(parent, "CallExpression") &&
    (parent.arguments ?? []).includes(node as never) &&
    isNodeOfType(parent.callee, "MemberExpression") &&
    !parent.callee.computed &&
    isNodeOfType(parent.callee.property, "Identifier") &&
    parent.callee.property.name === "match",
  );
};

// `const result = await f(...)` where the binding (or a destructured
// success/error/ok field) is branch-checked in an `if` marks the callee as a
// result-object wrapper that folds errors into a resolved value. The await
// may sit inside a conditional/logical init
// (`const result = editing ? await update(...) : await create(...)`), or
// assign into a pre-declared binding (`response = await saveAddresses(...)`
// inside switch cases, checked via `response.success` afterwards).
const isResultObjectCheckedAwait = (
  awaitNode: EsTreeNodeOfType<"AwaitExpression">,
  checkedResultNames: ReadonlySet<string>,
): boolean => {
  let child: EsTreeNode = awaitNode;
  let parent: EsTreeNode | null | undefined = awaitNode.parent;
  while (
    parent &&
    ((isNodeOfType(parent, "ConditionalExpression") && parent.test !== child) ||
      isNodeOfType(parent, "LogicalExpression"))
  ) {
    child = parent;
    parent = parent.parent ?? null;
  }
  if (
    isNodeOfType(parent, "AssignmentExpression") &&
    parent.operator === "=" &&
    parent.right === child
  ) {
    return isNodeOfType(parent.left, "Identifier") && checkedResultNames.has(parent.left.name);
  }
  if (!isNodeOfType(parent, "VariableDeclarator") || parent.init !== child) return false;
  const bindingTarget = parent.id;
  if (isNodeOfType(bindingTarget, "Identifier")) return checkedResultNames.has(bindingTarget.name);
  if (isNodeOfType(bindingTarget, "ObjectPattern")) {
    return bindingTarget.properties.some(
      (property) =>
        isNodeOfType(property, "Property") &&
        isNodeOfType(property.key, "Identifier") &&
        RESULT_SHAPE_PROPERTY_NAMES.has(property.key.name) &&
        isNodeOfType(property.value, "Identifier") &&
        checkedResultNames.has(property.value.name),
    );
  }
  return false;
};

const CANCELLATION_GUARD_TEST_PATTERN = /cancel|abort|unmount|mounted|stale|ignore|dispos/i;

// `if (cancelled) return` / `if (error.name === 'AbortError') return` inside
// the catch only skips the reset on the teardown path, where the component
// is gone anyway — the live-path reset still runs.
const isCancellationGuardTest = (test: EsTreeNode): boolean => {
  let matches = false;
  walkAst(test, (child: EsTreeNode) => {
    if (matches) return false;
    if (isNodeOfType(child, "Identifier") && CANCELLATION_GUARD_TEST_PATTERN.test(child.name)) {
      matches = true;
      return false;
    }
    if (
      isNodeOfType(child, "Literal") &&
      typeof child.value === "string" &&
      child.value === "AbortError"
    ) {
      matches = true;
      return false;
    }
  });
  return matches;
};

// A `throw` or `return` in the catch handler's own scope skips the statements
// after the try, so the handler does not guarantee the trailing reset runs —
// unless the escape is behind a cancellation guard (teardown path only).
const catchHandlerEscapes = (handler: EsTreeNode): boolean => {
  let didFindEscape = false;
  walkAst(handler, (child: EsTreeNode) => {
    if (didFindEscape) return false;
    if (child !== handler && isFunctionLike(child)) return false;
    if (isNodeOfType(child, "ThrowStatement") || isNodeOfType(child, "ReturnStatement")) {
      let cursor: EsTreeNode | null | undefined = child.parent;
      let isCancellationGuarded = false;
      while (cursor && cursor !== handler) {
        if (
          isNodeOfType(cursor, "IfStatement") &&
          isCancellationGuardTest(cursor.test as EsTreeNode)
        ) {
          isCancellationGuarded = true;
          break;
        }
        cursor = cursor.parent ?? null;
      }
      if (!isCancellationGuarded) didFindEscape = true;
    }
  });
  return didFindEscape;
};

// When the await sits in a `try` whose catch swallows the error (no rethrow,
// no return) and the reset comes after that whole try statement, the reset
// runs on the rejection path too — it is semantically a `finally`.
const isRejectionSwallowedBeforeReset = (
  awaitNode: EsTreeNode,
  functionNode: EsTreeNode,
  resetStart: number,
): boolean => {
  let child: EsTreeNode = awaitNode;
  let cursor: EsTreeNode | null | undefined = awaitNode.parent;
  while (cursor && cursor !== functionNode) {
    if (isNodeOfType(cursor, "TryStatement") && cursor.block === child && cursor.handler) {
      const tryEnd = getNodeEnd(cursor);
      if (tryEnd !== null && tryEnd < resetStart && !catchHandlerEscapes(cursor.handler)) {
        return true;
      }
    }
    child = cursor;
    cursor = cursor.parent ?? null;
  }
  return false;
};

const collectIfBranches = (
  node: EsTreeNode,
  functionNode: EsTreeNode,
): Map<EsTreeNode, "consequent" | "alternate"> => {
  const branches = new Map<EsTreeNode, "consequent" | "alternate">();
  let child: EsTreeNode = node;
  let cursor: EsTreeNode | null | undefined = node.parent;
  while (cursor && cursor !== functionNode) {
    if (isNodeOfType(cursor, "IfStatement")) {
      if (cursor.consequent === child) branches.set(cursor, "consequent");
      else if (cursor.alternate === child) branches.set(cursor, "alternate");
    }
    child = cursor;
    cursor = cursor.parent ?? null;
  }
  return branches;
};

// Source-offset ordering merges mutually exclusive if/else branches; two nodes
// on opposite branches of the same `if` never execute on the same call.
const enclosingSwitchCase = (node: EsTreeNode, functionNode: EsTreeNode): EsTreeNode | null => {
  let cursor: EsTreeNode | null | undefined = node.parent;
  while (cursor && cursor !== functionNode) {
    if (isNodeOfType(cursor, "SwitchCase")) return cursor;
    if (isFunctionLike(cursor)) return null;
    cursor = cursor.parent ?? null;
  }
  return null;
};

const areOnExclusiveBranches = (
  first: EsTreeNode,
  second: EsTreeNode,
  functionNode: EsTreeNode,
): boolean => {
  const firstBranches = collectIfBranches(first, functionNode);
  const secondBranches = collectIfBranches(second, functionNode);
  for (const [ifNode, branch] of firstBranches) {
    const otherBranch = secondBranches.get(ifNode);
    if (otherBranch && otherBranch !== branch) return true;
  }
  // Different cases of the same switch never run on the same dispatch.
  const firstCase = enclosingSwitchCase(first, functionNode);
  const secondCase = enclosingSwitchCase(second, functionNode);
  if (
    firstCase &&
    secondCase &&
    firstCase !== secondCase &&
    firstCase.parent === secondCase.parent
  ) {
    return true;
  }
  return false;
};

const recordCheckedResultName = (
  identifier: EsTreeNodeOfType<"Identifier">,
  checkedResultNames: Set<string>,
): void => {
  const parent = identifier.parent;
  if (
    isNodeOfType(parent, "MemberExpression") &&
    parent.object === identifier &&
    !parent.computed &&
    isNodeOfType(parent.property, "Identifier") &&
    RESULT_SHAPE_PROPERTY_NAMES.has(parent.property.name)
  ) {
    checkedResultNames.add(identifier.name);
    return;
  }
  if (
    isNodeOfType(parent, "IfStatement") ||
    isNodeOfType(parent, "ConditionalExpression") ||
    (isNodeOfType(parent, "UnaryExpression") && parent.operator === "!") ||
    isNodeOfType(parent, "LogicalExpression")
  ) {
    checkedResultNames.add(identifier.name);
    return;
  }
  // `if ('error' in result)` — an existence check on a result-shape field.
  if (
    isNodeOfType(parent, "BinaryExpression") &&
    parent.operator === "in" &&
    parent.right === identifier &&
    isNodeOfType(parent.left, "Literal") &&
    typeof parent.left.value === "string" &&
    RESULT_SHAPE_PROPERTY_NAMES.has(parent.left.value)
  ) {
    checkedResultNames.add(identifier.name);
    return;
  }
  // `fetchUsers.fulfilled.match(action)` — Redux Toolkit's result check.
  if (
    isNodeOfType(parent, "CallExpression") &&
    (parent.arguments ?? []).includes(identifier as never) &&
    isNodeOfType(parent.callee, "MemberExpression") &&
    !parent.callee.computed &&
    isNodeOfType(parent.callee.property, "Identifier") &&
    parent.callee.property.name === "match"
  ) {
    checkedResultNames.add(identifier.name);
  }
};

// `for (const entry of results) { if (!entry.success) ... }` — per-element
// result-shape checks mark the iterated binding as a checked result.
const recordForOfResultCheck = (
  forOfNode: EsTreeNodeOfType<"ForOfStatement">,
  checkedResultNames: Set<string>,
): void => {
  const right = unwrapChainExpression(forOfNode.right as EsTreeNode);
  if (!isNodeOfType(right, "Identifier")) return;
  const left = forOfNode.left;
  if (!isNodeOfType(left, "VariableDeclaration")) return;
  const declarator = left.declarations?.[0];
  if (!declarator || !isNodeOfType(declarator.id, "Identifier")) return;
  const elementName = declarator.id.name;
  let checksResultShape = false;
  walkAst(forOfNode.body as EsTreeNode, (child: EsTreeNode) => {
    if (checksResultShape) return false;
    if (
      isNodeOfType(child, "MemberExpression") &&
      !child.computed &&
      isNodeOfType(child.object, "Identifier") &&
      child.object.name === elementName &&
      isNodeOfType(child.property, "Identifier") &&
      RESULT_SHAPE_PROPERTY_NAMES.has(child.property.name)
    ) {
      checksResultShape = true;
      return false;
    }
  });
  if (checksResultShape) checkedResultNames.add(right.name);
};

// `<results>.filter((entry) => !entry.success)`-style calls: a result-shape
// field of the callback parameter is checked per element, marking the awaited
// `<results>` binding (e.g. from `await Promise.all(...)`) as a never-rejecting
// result-object wrapper whose errors are consumed via the resolved value.
const getResultCheckedArrayCallbackBindingName = (
  callNode: EsTreeNodeOfType<"CallExpression">,
): string | null => {
  const callee = unwrapChainExpression(callNode.callee);
  if (!isNodeOfType(callee, "MemberExpression") || callee.computed) return null;
  if (!isNodeOfType(callee.property, "Identifier")) return null;
  if (!ARRAY_CALLBACK_METHOD_NAMES.has(callee.property.name)) return null;
  const calleeObject = unwrapChainExpression(callee.object);
  if (!isNodeOfType(calleeObject, "Identifier")) return null;
  const callback = callNode.arguments[0];
  if (!isFunctionLike(callback)) return null;
  const firstParameter = callback.params[0];
  if (!firstParameter || !isNodeOfType(firstParameter, "Identifier")) return null;
  const parameterName = firstParameter.name;
  let didFindResultShapeCheck = false;
  walkAst(callback.body, (child: EsTreeNode) => {
    if (
      isNodeOfType(child, "MemberExpression") &&
      !child.computed &&
      isNodeOfType(child.object, "Identifier") &&
      child.object.name === parameterName &&
      isNodeOfType(child.property, "Identifier") &&
      RESULT_SHAPE_PROPERTY_NAMES.has(child.property.name)
    ) {
      didFindResultShapeCheck = true;
    }
  });
  return didFindResultShapeCheck ? calleeObject.name : null;
};

interface SetterCall {
  value: boolean;
  start: number;
  context: "finally" | "catch" | "plain";
  node: EsTreeNode;
}

interface AwaitSite {
  node: EsTreeNodeOfType<"AwaitExpression">;
  start: number;
}

const analyzeFunction = (functionNode: EsTreeNode, context: RuleContext): void => {
  const awaitSites: AwaitSite[] = [];
  const settersByName = new Map<string, SetterCall[]>();
  const checkedResultNames = new Set<string>();

  // `catch (e) { resetUploadState() }` where the same-file sync helper's body
  // does `setUploadingFile(false)` — the flag is cleared on the rejection
  // path via the helper, so each flag it resets counts as a catch reset.
  const registerHelperResets = (callNode: EsTreeNodeOfType<"CallExpression">): void => {
    if (!isNodeOfType(callNode.callee, "Identifier")) return;
    const start = getNodeStart(callNode);
    if (start === null) return;
    const resetContext = classifyResetContext(callNode, functionNode);
    if (resetContext === "plain") return;
    const helper = resolveSameFileHelperFunction(callNode);
    if (!helper || !isFunctionLike(helper) || helper.async) return;
    walkOwnFunctionScope(helper, (child: EsTreeNode) => {
      if (!isNodeOfType(child, "CallExpression")) return;
      const helperSetter = getSetterBooleanValue(child);
      if (!helperSetter || helperSetter.value) return;
      if (!LOADING_FLAG_SETTER_PATTERN.test(helperSetter.setterName)) return;
      const list = settersByName.get(helperSetter.setterName) ?? [];
      list.push({ value: false, start, context: resetContext, node: callNode });
      settersByName.set(helperSetter.setterName, list);
    });
  };

  walkOwnFunctionScope(functionNode, (node) => {
    if (isNodeOfType(node, "AwaitExpression")) {
      const start = getNodeStart(node);
      if (start !== null) awaitSites.push({ node, start });
      return;
    }
    if (isNodeOfType(node, "Identifier")) {
      if (isWithinIfTest(node, functionNode) || isMatchCallArgument(node)) {
        recordCheckedResultName(node, checkedResultNames);
      }
      return;
    }
    if (isNodeOfType(node, "ForOfStatement")) {
      recordForOfResultCheck(node, checkedResultNames);
      return;
    }
    if (!isNodeOfType(node, "CallExpression")) return;
    const resultCheckedBindingName = getResultCheckedArrayCallbackBindingName(node);
    if (resultCheckedBindingName) checkedResultNames.add(resultCheckedBindingName);
    const setter = getSetterBooleanValue(node);
    if (!setter) {
      registerHelperResets(node);
      return;
    }
    if (!LOADING_FLAG_SETTER_PATTERN.test(setter.setterName)) return;
    const start = getNodeStart(node);
    if (start === null) return;
    const list = settersByName.get(setter.setterName) ?? [];
    list.push({
      value: setter.value,
      start,
      context: classifyResetContext(node, functionNode),
      node,
    });
    settersByName.set(setter.setterName, list);
  });

  if (awaitSites.length === 0) return;

  for (const calls of settersByName.values()) {
    // A reset in `finally` always runs; a reset in `catch` mirrors the reset
    // on the rejection path. Either discharges the clear-obligation, so the
    // flag is not stuck.
    if (
      calls.some((call) => !call.value && (call.context === "finally" || call.context === "catch"))
    ) {
      continue;
    }

    const truthySets = calls.filter((call) => call.value);
    if (truthySets.length === 0) continue;
    const plainResets = calls.filter((call) => !call.value && call.context === "plain");

    for (const reset of plainResets) {
      const stuckFlagAwait = awaitSites.find(
        (awaitSite) =>
          awaitSite.start < reset.start &&
          !isNeverRejectingAwaitedExpression(awaitSite.node) &&
          !isResultObjectCheckedAwait(awaitSite.node, checkedResultNames) &&
          !isRejectionSwallowedBeforeReset(awaitSite.node, functionNode, reset.start) &&
          truthySets.some(
            (truthySet) =>
              truthySet.start < awaitSite.start &&
              !areOnExclusiveBranches(truthySet.node, reset.node, functionNode) &&
              !areOnExclusiveBranches(truthySet.node, awaitSite.node, functionNode) &&
              !areOnExclusiveBranches(awaitSite.node, reset.node, functionNode),
          ),
      );
      if (stuckFlagAwait) {
        context.report({ node: reset.node, message: MESSAGE });
        return;
      }
    }
  }
};

export const noLoadingFlagResetOutsideFinally = defineRule({
  id: "no-loading-flag-reset-outside-finally",
  title: "Loading flag reset outside finally",
  severity: "warn",
  category: "Correctness",
  recommendation:
    "A trailing `setLoading(false)` after an `await` never runs if the awaited call rejects, so the flag stays stuck truthy; reset it in a `finally` block (or mirror the reset on every catch) so it clears on both paths.",
  create: (context: RuleContext): RuleVisitors => {
    if (isTestFileFilename(context.filename)) return {};
    currentLintedFilename = context.filename;
    crossFileResolutionsRemaining = CROSS_FILE_RESOLUTION_BUDGET_PER_FILE;
    crossFileResolutionMemo.clear();
    isAnalyzingForeignHelperBody = false;
    return {
      ArrowFunctionExpression(node: EsTreeNodeOfType<"ArrowFunctionExpression">) {
        analyzeFunction(node, context);
      },
      FunctionExpression(node: EsTreeNodeOfType<"FunctionExpression">) {
        analyzeFunction(node, context);
      },
      FunctionDeclaration(node: EsTreeNodeOfType<"FunctionDeclaration">) {
        analyzeFunction(node, context);
      },
    };
  },
});
