import { defineRule } from "../../utils/define-rule.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
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
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactHookResultReference } from "../../utils/is-react-hook-result-reference.js";
import type { ResolvedCrossFileExport } from "../../utils/resolve-cross-file-export.js";
import { resolveCrossFileExport } from "../../utils/resolve-cross-file-export.js";
import { resolveExactLocalFunction } from "../../utils/resolve-exact-local-function.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { subtreeCanThrowSynchronously } from "../../utils/subtree-can-throw-synchronously.js";
import { walkAst } from "../../utils/walk-ast.js";
import { walkOwnFunctionScope } from "../../utils/walk-own-function-scope.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { RuleVisitors } from "../../utils/rule-visitors.js";

const MESSAGE =
  "This resets a loading/busy flag only on the success path: if the awaited call rejects the reset never runs and the flag stays stuck truthy (a spinner that never stops, a button disabled forever). Move the reset into a `finally` block, or mirror it on every catch, so it clears on rejection too.";
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
const STATE_HOOK_NAMES = new Set(["useState", "useReducer"]);
const getNodeStart = (node: EsTreeNode): number | null => {
  const start = (node as { start?: unknown }).start;
  return typeof start === "number" ? start : null;
};

const getNodeEnd = (node: EsTreeNode): number | null => {
  const end = (node as { end?: unknown }).end;
  return typeof end === "number" ? end : null;
};
const getSetterBooleanValue = (
  node: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): { setterName: string; value: boolean } | null => {
  if (!isNodeOfType(node.callee, "Identifier")) return null;
  if (
    !isReactHookResultReference(node.callee, STATE_HOOK_NAMES, 1, context.scopes) &&
    !context.scopes.isGlobalReference(node.callee)
  ) {
    return null;
  }
  const firstArgument = node.arguments[0];
  if (!firstArgument) return null;
  const strippedArgument = stripParenExpression(firstArgument);
  if (isNodeOfType(strippedArgument, "Literal")) {
    if (typeof strippedArgument.value !== "boolean") return null;
    return { setterName: node.callee.name, value: strippedArgument.value };
  }
  if (
    isNodeOfType(strippedArgument, "ArrowFunctionExpression") &&
    !isNodeOfType(strippedArgument.body, "BlockStatement")
  ) {
    const returnedValue = stripParenExpression(strippedArgument.body);
    if (isNodeOfType(returnedValue, "Literal") && typeof returnedValue.value === "boolean") {
      return { setterName: node.callee.name, value: returnedValue.value };
    }
  }
  return null;
};
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
const NEVER_REJECTING_ANALYSIS_MAX_DEPTH = 3;

const REDUX_DISPATCH_CALLEE_NAME_PATTERN = /dispatch$/i;
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
const isArrayBindingOfNeverRejectingPromises = (
  identifier: EsTreeNodeOfType<"Identifier">,
  depth: number,
  scopes?: ScopeAnalysis,
): boolean => {
  if (depth <= 0) return false;
  const binding = findVariableInitializer(identifier, identifier.name);
  if (!binding?.initializer) return false;
  const initializer = stripParenExpression(binding.initializer);
  if (!isNodeOfType(initializer, "ArrayExpression")) return false;
  if (
    !initializer.elements.every(
      (element) => element !== null && isNeverRejectingExpression(element, depth - 1, scopes),
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
      !(child.arguments ?? []).every((argument) =>
        isNeverRejectingExpression(argument, depth - 1, scopes),
      )
    ) {
      isRejectionProof = false;
      return false;
    }
  });
  return isRejectionProof;
};

const getPromiseCombinatorMethodName = (
  callNode: EsTreeNodeOfType<"CallExpression">,
  scopes?: ScopeAnalysis,
): string | null => {
  const callee = stripParenExpression(callNode.callee);
  if (!isNodeOfType(callee, "MemberExpression") || callee.computed) return null;
  if (!isNodeOfType(callee.object, "Identifier") || callee.object.name !== "Promise") return null;
  if (scopes && !scopes.isGlobalReference(callee.object)) return null;
  return isNodeOfType(callee.property, "Identifier") ? callee.property.name : null;
};
const isNeverRejectingPromiseCombinatorCall = (
  callNode: EsTreeNodeOfType<"CallExpression">,
  depth: number,
  scopes?: ScopeAnalysis,
): boolean => {
  const methodName = getPromiseCombinatorMethodName(callNode, scopes);
  if (methodName === "allSettled") {
    const argument = callNode.arguments[0] ? stripParenExpression(callNode.arguments[0]) : null;
    const isDefinitelyNonIterableObjectLiteral =
      isNodeOfType(argument, "ObjectExpression") &&
      argument.properties.every((property) => {
        if (!isNodeOfType(property, "Property")) return false;
        if (!property.computed) return true;
        const key = stripParenExpression(property.key);
        if (isNodeOfType(key, "Literal")) return true;
        if (!isNodeOfType(key, "MemberExpression")) return false;
        const receiver = stripParenExpression(key.object);
        if (
          !isNodeOfType(receiver, "Identifier") ||
          receiver.name !== "Symbol" ||
          (scopes && !scopes.isGlobalReference(receiver))
        ) {
          return false;
        }
        return (
          getStaticPropertyName(key) !== "iterator" ||
          !isFunctionLike(stripParenExpression(property.value))
        );
      });
    return !(
      !argument ||
      (isNodeOfType(argument, "Literal") &&
        (argument.value === null ||
          typeof argument.value === "number" ||
          typeof argument.value === "boolean")) ||
      isDefinitelyNonIterableObjectLiteral
    );
  }
  if (methodName !== "all") return false;
  const argument = callNode.arguments[0];
  if (!argument) return false;
  const stripped = stripParenExpression(argument);
  if (isNodeOfType(stripped, "ArrayExpression")) {
    return stripped.elements.every(
      (element) => element !== null && isNeverRejectingExpression(element, depth, scopes),
    );
  }
  if (isNodeOfType(stripped, "Identifier")) {
    return isArrayBindingOfNeverRejectingPromises(stripped, depth, scopes);
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
const isSyncArrayLiteralMethodCall = (callNode: EsTreeNodeOfType<"CallExpression">): boolean => {
  const callee = stripParenExpression(callNode.callee);
  if (!isNodeOfType(callee, "MemberExpression") || callee.computed) return false;
  if (!isNodeOfType(callee.property, "Identifier")) return false;
  if (!SYNC_ARRAY_METHOD_NAMES.has(callee.property.name)) return false;
  const receiver = stripParenExpression(callee.object);
  if (!isNodeOfType(receiver, "ArrayExpression")) return false;
  return (callNode.arguments ?? []).every((argument) => !subtreeContainsThrow(argument));
};

const returnedExpressionCanReject = (
  expression: EsTreeNode,
  depth: number,
  scopes?: ScopeAnalysis,
): boolean => {
  const returned = stripParenExpression(expression);
  if (isNodeOfType(returned, "CallExpression")) {
    if (isSyncArrayLiteralMethodCall(returned)) return false;
    return !isNeverRejectingExpression(returned, depth, scopes);
  }
  if (isNodeOfType(returned, "NewExpression")) {
    const isPromiseConstruction =
      isNodeOfType(returned.callee, "Identifier") && returned.callee.name === "Promise";
    return isPromiseConstruction && !isNonRejectingPromiseConstruction(returned, scopes);
  }
  return false;
};
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
  scopes?: ScopeAnalysis,
): EsTreeNode | null => {
  const callee = stripParenExpression(callNode.callee);
  if (isNodeOfType(callee, "Identifier")) {
    const binding = findVariableInitializer(callee, callee.name);
    if (!binding?.initializer) return null;
    const declaration = binding.bindingIdentifier.parent;
    if (scopes && isNodeOfType(declaration, "FunctionDeclaration")) {
      return resolveExactLocalFunction(callee, scopes);
    }
    if (
      !isNodeOfType(declaration, "FunctionDeclaration") &&
      !isNodeOfType(declaration, "ImportSpecifier") &&
      !isNodeOfType(declaration, "ImportDefaultSpecifier") &&
      (!isNodeOfType(declaration, "VariableDeclarator") ||
        !isNodeOfType(declaration.parent, "VariableDeclaration") ||
        declaration.parent.kind !== "const")
    ) {
      return null;
    }
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
const isRejectionProofAsyncHelperBody = (
  helper: EsTreeNode,
  depth: number,
  scopes?: ScopeAnalysis,
): boolean => {
  if (scopes && subtreeCanThrowSynchronously(helper, helper, scopes)) return false;
  let isRejectionProof = true;
  walkOwnFunctionScope(helper, (child: EsTreeNode) => {
    if (!isRejectionProof) return false;
    if (isNodeOfType(child, "AwaitExpression")) {
      const awaited = child.argument ? stripParenExpression(child.argument) : null;
      const isSafeAwait =
        (awaited !== null && isNeverRejectingExpression(awaited, depth - 1, scopes)) ||
        isInsideNonRethrowingTry(child, helper);
      if (!isSafeAwait) isRejectionProof = false;
      return;
    }
    if (isNodeOfType(child, "ThrowStatement")) {
      if (!isInsideNonRethrowingTry(child, helper)) isRejectionProof = false;
      return;
    }
    if (isNodeOfType(child, "ReturnStatement") && child.argument) {
      if (returnedExpressionCanReject(child.argument, depth - 1, scopes)) {
        isRejectionProof = false;
      }
    }
  });
  if (
    isNodeOfType(helper, "ArrowFunctionExpression") &&
    !isNodeOfType(helper.body, "BlockStatement") &&
    returnedExpressionCanReject(helper.body, depth - 1, scopes)
  ) {
    isRejectionProof = false;
  }
  return isRejectionProof;
};
const CROSS_FILE_RESOLUTION_BUDGET_PER_FILE = 3;
let currentLintedFilename: string | undefined;
let crossFileResolutionsRemaining = 0;
const crossFileResolutionMemo = new Map<string, ResolvedCrossFileExport | null>();
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
const resolveImportedHelperIdentifierThroughConstAliases = (
  callee: EsTreeNodeOfType<"Identifier">,
): EsTreeNodeOfType<"Identifier"> | null => {
  let identifier = callee;
  const visitedNames = new Set<string>();
  while (!visitedNames.has(identifier.name)) {
    visitedNames.add(identifier.name);
    const binding = findVariableInitializer(identifier, identifier.name);
    if (!binding?.initializer) return identifier;
    const initializer = stripParenExpression(binding.initializer);
    if (
      isNodeOfType(initializer, "ImportSpecifier") ||
      isNodeOfType(initializer, "ImportDefaultSpecifier")
    ) {
      return identifier;
    }
    const declarator = binding.bindingIdentifier.parent;
    const declaration = declarator?.parent;
    if (
      !isNodeOfType(declarator, "VariableDeclarator") ||
      !isNodeOfType(declaration, "VariableDeclaration") ||
      declaration.kind !== "const"
    ) {
      return null;
    }
    if (!isNodeOfType(initializer, "Identifier")) return null;
    identifier = initializer;
  }
  return null;
};
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
const isNeverRejectingLocalAsyncHelperCall = (
  callNode: EsTreeNodeOfType<"CallExpression">,
  depth: number,
  scopes?: ScopeAnalysis,
): boolean => {
  if (depth <= 0) return false;
  const helper = resolveSameFileHelperFunction(callNode, scopes);
  if (helper && isFunctionLike(helper)) {
    return Boolean(helper.async) && isRejectionProofAsyncHelperBody(helper, depth, scopes);
  }
  if (isAnalyzingForeignHelperBody) return false;
  const callee = stripParenExpression(callNode.callee);
  if (!isNodeOfType(callee, "Identifier")) return false;
  if (helper && isNodeOfType(helper, "ImportSpecifier")) {
    return isNeverRejectingImportedAsyncHelperCall(callee, depth);
  }
  const importedHelperIdentifier = resolveImportedHelperIdentifierThroughConstAliases(callee);
  if (importedHelperIdentifier) {
    const importBinding = getImportBindingForName(
      importedHelperIdentifier,
      importedHelperIdentifier.name,
    );
    if (importBinding) {
      return isNeverRejectingImportedAsyncHelperCall(importedHelperIdentifier, depth);
    }
  }
  if (helper) return false;
  return isNeverRejectingImportedHookFunctionCall(callee, depth);
};

const isNeverRejectingExpression = (
  expression: EsTreeNode,
  depth: number,
  scopes?: ScopeAnalysis,
): boolean => {
  const inner = stripParenExpression(expression);
  if (isNonRejectingPromiseConstruction(inner, scopes)) return true;
  if (!isNodeOfType(inner, "CallExpression")) return false;
  if (isPromiseResolveCall(inner, scopes)) return true;
  if (isThunkActionDispatchCall(inner)) return true;
  if (chainCarriesRejectionHandler(inner, scopes)) return true;
  if (isNeverRejectingPromiseCombinatorCall(inner, depth, scopes)) return true;
  if (isNeverRejectingHelperCall(inner, scopes)) return true;
  return isNeverRejectingLocalAsyncHelperCall(inner, depth, scopes);
};
const isNeverRejectingAwaitedExpression = (
  awaitNode: EsTreeNodeOfType<"AwaitExpression">,
  scopes: ScopeAnalysis,
): boolean => {
  const awaited = awaitNode.argument;
  if (!awaited) return false;
  return isNeverRejectingExpression(awaited, NEVER_REJECTING_ANALYSIS_MAX_DEPTH, scopes);
};

const CANCELLATION_GUARD_TEST_PATTERN = /cancel|abort|unmount|mounted|stale|ignore|dispos/i;
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

interface CatchPathState {
  isCleared: boolean;
  isCancellationPath: boolean;
}

interface CatchPathAnalysis {
  states: CatchPathState[];
  hasUnsafeExit: boolean;
}

const dedupeCatchPathStates = (states: CatchPathState[]): CatchPathState[] => {
  const statesByKey = new Map<string, CatchPathState>();
  for (const state of states) {
    statesByKey.set(`${Number(state.isCleared)}:${Number(state.isCancellationPath)}`, state);
  }
  return [...statesByKey.values()];
};

const catchHandlerCanBypassReset = (
  handler: EsTreeNode,
  functionNode: EsTreeNode,
  setterName: string,
  context: RuleContext,
  doesContinuingPathReachReset: boolean,
): boolean => {
  const expressionUnconditionallyClearsFlag = (expression: EsTreeNode): boolean => {
    const stripped = stripParenExpression(expression);
    if (isNodeOfType(stripped, "CallExpression")) {
      const setter = getSetterBooleanValue(stripped, context);
      if (setter?.setterName === setterName && !setter.value) return true;
      const helper = resolveSameFileHelperFunction(stripped, context.scopes);
      if (!helper || !isFunctionLike(helper) || helper.async) return false;
      let clearsUnconditionally = false;
      walkOwnFunctionScope(helper, (child: EsTreeNode) => {
        if (!isNodeOfType(child, "CallExpression")) return;
        const helperSetter = getSetterBooleanValue(child, context);
        if (
          helperSetter?.setterName === setterName &&
          !helperSetter.value &&
          isUnconditionallyExecutedWithinFunction(child, helper, context)
        ) {
          clearsUnconditionally = true;
          return false;
        }
      });
      return clearsUnconditionally;
    }
    return false;
  };

  const analyzeExpression = (
    expression: EsTreeNode,
    states: CatchPathState[],
  ): CatchPathAnalysis => {
    const stripped = stripParenExpression(expression);
    if (isNodeOfType(stripped, "ConditionalExpression")) {
      const consequent = analyzeExpression(
        stripped.consequent,
        states.map((state) => ({ ...state })),
      );
      if (consequent.hasUnsafeExit) return consequent;
      const alternate = analyzeExpression(
        stripped.alternate,
        states.map((state) => ({ ...state })),
      );
      return {
        states: dedupeCatchPathStates([...consequent.states, ...alternate.states]),
        hasUnsafeExit: alternate.hasUnsafeExit,
      };
    }
    if (isNodeOfType(stripped, "SequenceExpression")) {
      let sequenceStates = states;
      for (const sequenceExpression of stripped.expressions) {
        const analyzed = analyzeExpression(sequenceExpression, sequenceStates);
        if (analyzed.hasUnsafeExit) return analyzed;
        sequenceStates = analyzed.states;
      }
      return { states: sequenceStates, hasUnsafeExit: false };
    }
    if (isNodeOfType(stripped, "LogicalExpression")) {
      const left = analyzeExpression(stripped.left, states);
      if (left.hasUnsafeExit) return left;
      const right = analyzeExpression(
        stripped.right,
        left.states.map((state) => ({ ...state })),
      );
      return {
        states: dedupeCatchPathStates([...left.states, ...right.states]),
        hasUnsafeExit: right.hasUnsafeExit,
      };
    }
    if (
      subtreeCanThrowSynchronously(stripped, functionNode, context.scopes) &&
      states.some(
        (state) => !state.isCleared && !(doesContinuingPathReachReset && state.isCancellationPath),
      )
    ) {
      return { states: [], hasUnsafeExit: true };
    }
    if (!expressionUnconditionallyClearsFlag(stripped)) {
      return { states, hasUnsafeExit: false };
    }
    return {
      states: states.map((state) => ({ ...state, isCleared: true })),
      hasUnsafeExit: false,
    };
  };

  const analyzeStatements = (
    statements: EsTreeNode[],
    initialStates: CatchPathState[],
  ): CatchPathAnalysis => {
    let states = initialStates;
    for (const statement of statements) {
      if (states.length === 0) break;
      if (isNodeOfType(statement, "ReturnStatement") || isNodeOfType(statement, "ThrowStatement")) {
        if (statement.argument) {
          const argumentAnalysis = analyzeExpression(statement.argument, states);
          if (argumentAnalysis.hasUnsafeExit) return argumentAnalysis;
          states = argumentAnalysis.states;
        }
        const hasUnsafeExit = states.some(
          (state) =>
            !state.isCleared && !(doesContinuingPathReachReset && state.isCancellationPath),
        );
        if (hasUnsafeExit) return { states: [], hasUnsafeExit: true };
        states = [];
        continue;
      }
      if (isNodeOfType(statement, "BlockStatement")) {
        const nested = analyzeStatements(statement.body as EsTreeNode[], states);
        if (nested.hasUnsafeExit) return nested;
        states = nested.states;
        continue;
      }
      if (isNodeOfType(statement, "IfStatement")) {
        const testAnalysis = analyzeExpression(statement.test, states);
        if (testAnalysis.hasUnsafeExit) return testAnalysis;
        states = testAnalysis.states;
        const isCancellationPath = isCancellationGuardTest(statement.test as EsTreeNode);
        const consequent = analyzeStatements(
          isNodeOfType(statement.consequent, "BlockStatement")
            ? (statement.consequent.body as EsTreeNode[])
            : [statement.consequent as EsTreeNode],
          states.map((state) => ({
            ...state,
            isCancellationPath: state.isCancellationPath || isCancellationPath,
          })),
        );
        if (consequent.hasUnsafeExit) return consequent;
        const alternate = statement.alternate
          ? analyzeStatements(
              isNodeOfType(statement.alternate, "BlockStatement")
                ? (statement.alternate.body as EsTreeNode[])
                : [statement.alternate as EsTreeNode],
              states.map((state) => ({ ...state })),
            )
          : { states: states.map((state) => ({ ...state })), hasUnsafeExit: false };
        if (alternate.hasUnsafeExit) return alternate;
        states = dedupeCatchPathStates([...consequent.states, ...alternate.states]);
        continue;
      }
      if (isNodeOfType(statement, "VariableDeclaration")) {
        for (const declaration of statement.declarations) {
          if (!declaration.init) continue;
          const initializerAnalysis = analyzeExpression(declaration.init, states);
          if (initializerAnalysis.hasUnsafeExit) return initializerAnalysis;
          states = initializerAnalysis.states;
        }
        continue;
      }
      if (isNodeOfType(statement, "ExpressionStatement")) {
        const analyzed = analyzeExpression(statement.expression as EsTreeNode, states);
        if (analyzed.hasUnsafeExit) return analyzed;
        states = analyzed.states;
      }
    }
    return { states, hasUnsafeExit: false };
  };

  const body = isNodeOfType(handler, "CatchClause") ? handler.body : handler;
  const statements = isNodeOfType(body, "BlockStatement")
    ? (body.body as EsTreeNode[])
    : [body as EsTreeNode];
  const analysis = analyzeStatements(statements, [{ isCleared: false, isCancellationPath: false }]);
  return (
    analysis.hasUnsafeExit ||
    (!doesContinuingPathReachReset && analysis.states.some((state) => !state.isCleared))
  );
};
const isRejectionSwallowedBeforeReset = (
  awaitNode: EsTreeNode,
  functionNode: EsTreeNode,
  resetStart: number,
  setterName: string,
  context: RuleContext,
): boolean => {
  let child: EsTreeNode = awaitNode;
  let cursor: EsTreeNode | null | undefined = awaitNode.parent;
  while (cursor && cursor !== functionNode) {
    if (isNodeOfType(cursor, "TryStatement") && cursor.block === child && cursor.handler) {
      const tryEnd = getNodeEnd(cursor);
      if (
        tryEnd !== null &&
        tryEnd < resetStart &&
        !catchHandlerCanBypassReset(cursor.handler, functionNode, setterName, context, true)
      ) {
        return true;
      }
    }
    child = cursor;
    cursor = cursor.parent ?? null;
  }
  return false;
};

const collectConditionalBranches = (
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
    if (isNodeOfType(cursor, "ConditionalExpression")) {
      if (cursor.consequent === child) branches.set(cursor, "consequent");
      else if (cursor.alternate === child) branches.set(cursor, "alternate");
    }
    child = cursor;
    cursor = cursor.parent ?? null;
  }
  return branches;
};
const enclosingSwitchCase = (
  node: EsTreeNode,
  functionNode: EsTreeNode,
): EsTreeNodeOfType<"SwitchCase"> | null => {
  let cursor: EsTreeNode | null | undefined = node.parent;
  while (cursor && cursor !== functionNode) {
    if (isNodeOfType(cursor, "SwitchCase")) return cursor;
    if (isFunctionLike(cursor)) return null;
    cursor = cursor.parent ?? null;
  }
  return null;
};

const statementAlwaysExits = (node: EsTreeNode | null | undefined): boolean => {
  if (!node) return false;
  if (
    isNodeOfType(node, "BreakStatement") ||
    isNodeOfType(node, "ContinueStatement") ||
    isNodeOfType(node, "ReturnStatement") ||
    isNodeOfType(node, "ThrowStatement")
  ) {
    return true;
  }
  if (isNodeOfType(node, "BlockStatement")) {
    return statementAlwaysExits(node.body.at(-1));
  }
  if (isNodeOfType(node, "IfStatement") && node.alternate) {
    return statementAlwaysExits(node.consequent) && statementAlwaysExits(node.alternate);
  }
  return false;
};

const areSwitchCasesExclusive = (
  firstCase: EsTreeNodeOfType<"SwitchCase">,
  secondCase: EsTreeNodeOfType<"SwitchCase">,
): boolean => {
  const switchStatement = firstCase.parent;
  if (!isNodeOfType(switchStatement, "SwitchStatement") || secondCase.parent !== switchStatement) {
    return false;
  }
  const firstIndex = switchStatement.cases.findIndex((candidate) => candidate === firstCase);
  const secondIndex = switchStatement.cases.findIndex((candidate) => candidate === secondCase);
  if (firstIndex === -1 || secondIndex === -1) return false;
  const earlierIndex = Math.min(firstIndex, secondIndex);
  const laterIndex = Math.max(firstIndex, secondIndex);
  for (let caseIndex = earlierIndex; caseIndex < laterIndex; caseIndex += 1) {
    const currentCase = switchStatement.cases[caseIndex];
    if (statementAlwaysExits(currentCase.consequent.at(-1))) return true;
  }
  return false;
};

const areOnExclusiveBranches = (
  first: EsTreeNode,
  second: EsTreeNode,
  functionNode: EsTreeNode,
): boolean => {
  const firstBranches = collectConditionalBranches(first, functionNode);
  const secondBranches = collectConditionalBranches(second, functionNode);
  for (const [ifNode, branch] of firstBranches) {
    const otherBranch = secondBranches.get(ifNode);
    if (otherBranch && otherBranch !== branch) return true;
  }
  const firstCase = enclosingSwitchCase(first, functionNode);
  const secondCase = enclosingSwitchCase(second, functionNode);
  if (firstCase && secondCase && firstCase !== secondCase) {
    return areSwitchCasesExclusive(firstCase, secondCase);
  }
  return false;
};

interface SetterCall {
  value: boolean;
  start: number;
  context: "finally" | "catch" | "plain";
  node: EsTreeNode;
  protectingTry: EsTreeNodeOfType<"TryStatement"> | null;
  isUnconditional: boolean;
}

interface AwaitSite {
  node: EsTreeNodeOfType<"AwaitExpression">;
  start: number;
}

const hasAbruptCompletionBefore = (
  boundary: EsTreeNode,
  node: EsTreeNode,
  context: RuleContext,
): boolean => {
  const nodeStart = getNodeStart(node);
  if (nodeStart === null) return true;
  let hasAbruptCompletion = false;
  walkAst(boundary, (child: EsTreeNode) => {
    if (hasAbruptCompletion) return false;
    if (child !== boundary && isFunctionLike(child)) return false;
    const childStart = getNodeStart(child);
    if (childStart === null || childStart >= nodeStart) return;
    if (isNodeOfType(child, "ReturnStatement") || isNodeOfType(child, "ThrowStatement")) {
      hasAbruptCompletion = true;
      return false;
    }
    if (
      isNodeOfType(child, "CallExpression") &&
      subtreeCanThrowSynchronously(child, boundary, context.scopes)
    ) {
      hasAbruptCompletion = true;
      return false;
    }
  });
  return hasAbruptCompletion;
};

const isUnconditionallyExecutedWithinFunction = (
  node: EsTreeNode,
  functionNode: EsTreeNode,
  context: RuleContext,
): boolean => {
  let cursor: EsTreeNode | null | undefined = node.parent;
  while (cursor && cursor !== functionNode) {
    if (
      isNodeOfType(cursor, "IfStatement") ||
      isNodeOfType(cursor, "SwitchCase") ||
      isNodeOfType(cursor, "ConditionalExpression") ||
      isNodeOfType(cursor, "LogicalExpression") ||
      isNodeOfType(cursor, "ForStatement") ||
      isNodeOfType(cursor, "ForInStatement") ||
      isNodeOfType(cursor, "ForOfStatement") ||
      isNodeOfType(cursor, "WhileStatement") ||
      isNodeOfType(cursor, "DoWhileStatement")
    ) {
      return false;
    }
    cursor = cursor.parent ?? null;
  }
  return cursor === functionNode && !hasAbruptCompletionBefore(functionNode, node, context);
};

const getExceptionalResetProtection = (
  callNode: EsTreeNode,
  functionNode: EsTreeNode,
  context: RuleContext,
): Pick<SetterCall, "protectingTry" | "isUnconditional"> => {
  let child = callNode;
  let cursor: EsTreeNode | null | undefined = callNode.parent;
  let isUnconditional = true;
  while (cursor && cursor !== functionNode) {
    if (
      isNodeOfType(cursor, "IfStatement") ||
      isNodeOfType(cursor, "SwitchCase") ||
      isNodeOfType(cursor, "ConditionalExpression") ||
      isNodeOfType(cursor, "LogicalExpression") ||
      isNodeOfType(cursor, "ForStatement") ||
      isNodeOfType(cursor, "ForInStatement") ||
      isNodeOfType(cursor, "ForOfStatement") ||
      isNodeOfType(cursor, "WhileStatement") ||
      isNodeOfType(cursor, "DoWhileStatement")
    ) {
      isUnconditional = false;
    }
    if (isNodeOfType(cursor, "CatchClause")) {
      const tryStatement = cursor.parent;
      return {
        protectingTry: isNodeOfType(tryStatement, "TryStatement") ? tryStatement : null,
        isUnconditional:
          isUnconditional && !hasAbruptCompletionBefore(cursor.body, callNode, context),
      };
    }
    if (isNodeOfType(cursor, "TryStatement") && cursor.finalizer === child) {
      return {
        protectingTry: cursor,
        isUnconditional:
          isUnconditional &&
          Boolean(cursor.finalizer) &&
          !hasAbruptCompletionBefore(cursor.finalizer, callNode, context),
      };
    }
    child = cursor;
    cursor = cursor.parent ?? null;
  }
  return { protectingTry: null, isUnconditional: false };
};

const isAwaitInsideProtectedTry = (
  awaitNode: EsTreeNode,
  tryStatement: EsTreeNodeOfType<"TryStatement">,
): boolean => {
  let child = awaitNode;
  let cursor: EsTreeNode | null | undefined = awaitNode.parent;
  while (cursor && cursor !== tryStatement) {
    child = cursor;
    cursor = cursor.parent ?? null;
  }
  return cursor === tryStatement && tryStatement.block === child;
};

const collectExceptionallyProtectedAwaits = (
  awaitSites: ReadonlyArray<AwaitSite>,
  calls: ReadonlyArray<SetterCall>,
): ReadonlySet<EsTreeNode> => {
  const protectedAwaits = new Set<EsTreeNode>();
  const protectingTryStatements = new Set<EsTreeNodeOfType<"TryStatement">>();
  for (const call of calls) {
    if (!call.value && call.context !== "plain" && call.isUnconditional && call.protectingTry) {
      protectingTryStatements.add(call.protectingTry);
    }
  }
  for (const awaitSite of awaitSites) {
    let child: EsTreeNode = awaitSite.node;
    let cursor: EsTreeNode | null | undefined = awaitSite.node.parent;
    while (cursor) {
      if (
        isNodeOfType(cursor, "TryStatement") &&
        cursor.block === child &&
        protectingTryStatements.has(cursor)
      ) {
        protectedAwaits.add(awaitSite.node);
        break;
      }
      if (isFunctionLike(cursor)) break;
      child = cursor;
      cursor = cursor.parent ?? null;
    }
  }
  return protectedAwaits;
};

const findFirstAwaitAfter = (awaitSites: ReadonlyArray<AwaitSite>, start: number): number => {
  let low = 0;
  let high = awaitSites.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (awaitSites[middle].start <= start) low = middle + 1;
    else high = middle;
  }
  return low;
};

const analyzeFunction = (functionNode: EsTreeNode, context: RuleContext): void => {
  const awaitSites: AwaitSite[] = [];
  const settersByName = new Map<string, SetterCall[]>();
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
      const helperSetter = getSetterBooleanValue(child, context);
      if (!helperSetter || helperSetter.value) return;
      if (!LOADING_FLAG_SETTER_PATTERN.test(helperSetter.setterName)) return;
      const list = settersByName.get(helperSetter.setterName) ?? [];
      const protection = getExceptionalResetProtection(callNode, functionNode, context);
      list.push({
        value: false,
        start,
        context: resetContext,
        node: callNode,
        ...protection,
        isUnconditional:
          protection.isUnconditional &&
          isUnconditionallyExecutedWithinFunction(child, helper, context),
      });
      settersByName.set(helperSetter.setterName, list);
    });
  };

  walkOwnFunctionScope(functionNode, (node) => {
    if (isNodeOfType(node, "AwaitExpression")) {
      const start = getNodeStart(node);
      if (start !== null) awaitSites.push({ node, start });
      return;
    }
    if (!isNodeOfType(node, "CallExpression")) return;
    const setter = getSetterBooleanValue(node, context);
    if (!setter) {
      registerHelperResets(node);
      return;
    }
    if (!LOADING_FLAG_SETTER_PATTERN.test(setter.setterName)) return;
    const start = getNodeStart(node);
    if (start === null) return;
    const list = settersByName.get(setter.setterName) ?? [];
    const protection = getExceptionalResetProtection(node, functionNode, context);
    list.push({
      value: setter.value,
      start,
      context: classifyResetContext(node, functionNode),
      node,
      ...protection,
    });
    settersByName.set(setter.setterName, list);
  });

  if (awaitSites.length === 0) return;
  const rejectingAwaitNodes = new Set(
    awaitSites
      .filter((awaitSite) => !isNeverRejectingAwaitedExpression(awaitSite.node, context.scopes))
      .map((awaitSite) => awaitSite.node),
  );

  for (const [setterName, calls] of settersByName) {
    const truthySets = calls.filter((call) => call.value);
    if (truthySets.length === 0) continue;
    const exceptionallyProtectedAwaits = collectExceptionallyProtectedAwaits(awaitSites, calls);
    const riskyAwaitsWithTruthySet = awaitSites.filter(
      (awaitSite) =>
        rejectingAwaitNodes.has(awaitSite.node) &&
        !exceptionallyProtectedAwaits.has(awaitSite.node) &&
        truthySets.some(
          (truthySet) =>
            truthySet.start < awaitSite.start &&
            !areOnExclusiveBranches(truthySet.node, awaitSite.node, functionNode),
        ),
    );
    if (riskyAwaitsWithTruthySet.length === 0) continue;
    const conditionalExceptionalResets = calls.filter(
      (call) =>
        !call.value &&
        call.context !== "plain" &&
        !call.isUnconditional &&
        call.protectingTry !== null,
    );
    for (const reset of conditionalExceptionalResets) {
      const catchHandler = reset.protectingTry?.handler;
      if (
        catchHandler &&
        !catchHandlerCanBypassReset(catchHandler, functionNode, setterName, context, false)
      ) {
        continue;
      }
      const riskyAwait = riskyAwaitsWithTruthySet.find(
        (awaitSite) =>
          reset.protectingTry !== null &&
          isAwaitInsideProtectedTry(awaitSite.node, reset.protectingTry),
      );
      if (riskyAwait) {
        context.report({ node: reset.node, message: MESSAGE });
        return;
      }
    }
    const plainResets = calls.filter((call) => !call.value && call.context === "plain");

    for (const reset of plainResets) {
      for (let truthyIndex = truthySets.length - 1; truthyIndex >= 0; truthyIndex -= 1) {
        const truthySet = truthySets[truthyIndex];
        if (truthySet.start >= reset.start) continue;
        if (areOnExclusiveBranches(truthySet.node, reset.node, functionNode)) continue;
        const firstAwaitIndex = findFirstAwaitAfter(awaitSites, truthySet.start);
        for (let awaitIndex = firstAwaitIndex; awaitIndex < awaitSites.length; awaitIndex += 1) {
          const awaitSite = awaitSites[awaitIndex];
          if (awaitSite.start >= reset.start) break;
          if (
            areOnExclusiveBranches(truthySet.node, awaitSite.node, functionNode) ||
            areOnExclusiveBranches(awaitSite.node, reset.node, functionNode) ||
            !rejectingAwaitNodes.has(awaitSite.node) ||
            exceptionallyProtectedAwaits.has(awaitSite.node) ||
            isRejectionSwallowedBeforeReset(
              awaitSite.node,
              functionNode,
              reset.start,
              setterName,
              context,
            )
          ) {
            continue;
          }
          context.report({ node: reset.node, message: MESSAGE });
          return;
        }
        break;
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
