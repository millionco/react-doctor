import { EFFECT_HOOK_NAMES } from "../../constants/react.js";
import { analyzeScopes, type ScopeAnalysis } from "../../semantic/scope-analysis.js";
import { collectReturnedCleanupFunctions } from "../../utils/collect-returned-cleanup-functions.js";
import { collectConstAliasSymbols } from "../../utils/collect-const-alias-symbols.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { getImportBindingForName } from "../../utils/find-import-source-for-name.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import {
  chainCarriesRejectionHandler,
  isDefinitelyNonThenableValue,
  isInsideNonRethrowingTry,
  isNeverRejectingHelperCall,
  isNonRejectingPromiseConstruction,
  isPromiseResolveCall,
  subtreeContainsThrow,
} from "../../utils/is-never-rejecting-expression.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactApiCall } from "../../utils/is-react-api-call.js";
import { isReactHookResultReference } from "../../utils/is-react-hook-result-reference.js";
import type { ResolvedCrossFileExport } from "../../utils/resolve-cross-file-export.js";
import { resolveCrossFileExport } from "../../utils/resolve-cross-file-export.js";
import { resolveExactLocalFunction } from "../../utils/resolve-exact-local-function.js";
import { resolveExpressionKey } from "../../utils/resolve-expression-key.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { RuleVisitors } from "../../utils/rule-visitors.js";
import { serializeReferenceKey } from "../../utils/serialize-reference-key.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { subtreeCanThrowSynchronously } from "../../utils/subtree-can-throw-synchronously.js";
import { walkAst } from "../../utils/walk-ast.js";
import { walkOwnFunctionScope } from "../../utils/walk-own-function-scope.js";
import { walkSynchronousCallbackFlow } from "../../utils/walk-synchronous-callback-flow.js";

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
const USE_REF_HOOK_NAMES = new Set(["useRef"]);
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
): { setterKey: string; setterName: string; value: boolean } | null => {
  if (!isNodeOfType(node.callee, "Identifier")) return null;
  if (
    !isReactHookResultReference(node.callee, STATE_HOOK_NAMES, 1, context.scopes) &&
    !context.scopes.isGlobalReference(node.callee)
  ) {
    return null;
  }
  const setterKey = resolveExpressionKey(node.callee, context);
  if (!setterKey) return null;
  let setterSymbol = context.scopes.symbolFor(node.callee);
  const visitedSymbolIds = new Set<number>();
  while (
    setterSymbol?.kind === "const" &&
    setterSymbol.initializer &&
    !visitedSymbolIds.has(setterSymbol.id)
  ) {
    visitedSymbolIds.add(setterSymbol.id);
    const initializer = stripParenExpression(setterSymbol.initializer);
    if (!isNodeOfType(initializer, "Identifier")) break;
    setterSymbol = context.scopes.symbolFor(initializer);
  }
  const setterName = isNodeOfType(setterSymbol?.bindingIdentifier, "Identifier")
    ? setterSymbol.bindingIdentifier.name
    : node.callee.name;
  const firstArgument = node.arguments[0];
  if (!firstArgument) return null;
  const strippedArgument = stripParenExpression(firstArgument);
  if (isNodeOfType(strippedArgument, "Literal")) {
    if (typeof strippedArgument.value !== "boolean") return null;
    return { setterKey, setterName, value: strippedArgument.value };
  }
  if (
    isNodeOfType(strippedArgument, "ArrowFunctionExpression") &&
    !isNodeOfType(strippedArgument.body, "BlockStatement")
  ) {
    const returnedValue = stripParenExpression(strippedArgument.body);
    if (isNodeOfType(returnedValue, "Literal") && typeof returnedValue.value === "boolean") {
      return { setterKey, setterName, value: returnedValue.value };
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

const getUseCallbackWrappedFunction = (
  expression: EsTreeNode,
  scopes?: ScopeAnalysis,
  requireReactProvenance = false,
): EsTreeNode => {
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
  if (
    requireReactProvenance &&
    (!scopes ||
      !isReactApiCall(stripped, "useCallback", scopes, {
        allowGlobalReactNamespace: true,
        resolveNamedAliases: true,
      }))
  ) {
    return stripped;
  }
  const wrappedFunction = stripped.arguments[0];
  return wrappedFunction && isFunctionLike(wrappedFunction) ? wrappedFunction : stripped;
};
const isDefinitelyNonRejectingArrayValue = (
  expression: EsTreeNode,
  depth: number,
  scopes?: ScopeAnalysis,
  visitedSymbolIds = new Set<number>(),
): boolean => {
  const stripped = stripParenExpression(expression);
  if (isDefinitelyNonThenableValue(stripped)) return true;
  if (isNodeOfType(stripped, "CallExpression")) {
    return isNeverRejectingExpression(stripped, depth, scopes);
  }
  if (!scopes || !isNodeOfType(stripped, "Identifier")) return false;
  const symbol = scopes.symbolFor(stripped);
  if (
    !symbol ||
    symbol.kind !== "const" ||
    !symbol.initializer ||
    visitedSymbolIds.has(symbol.id) ||
    symbol.references.some((reference) => reference.flag !== "read")
  ) {
    return false;
  }
  visitedSymbolIds.add(symbol.id);
  return isDefinitelyNonRejectingArrayValue(
    symbol.initializer,
    depth - 1,
    scopes,
    visitedSymbolIds,
  );
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
      (element) =>
        element === null || isDefinitelyNonRejectingArrayValue(element, depth - 1, scopes),
    )
  ) {
    return false;
  }
  if (!scopes) return false;
  const arraySymbol = scopes.symbolFor(identifier);
  if (!arraySymbol) return false;
  const synchronouslyExecutedNodes = new Set<EsTreeNode>();
  walkSynchronousCallbackFlow(binding.scopeOwner, (node) => {
    synchronouslyExecutedNodes.add(node);
  });
  for (const aliasSymbol of collectConstAliasSymbols(arraySymbol, scopes)) {
    for (const reference of aliasSymbol.references) {
      if (reference.identifier.range[0] > identifier.range[0]) continue;
      if (!synchronouslyExecutedNodes.has(reference.identifier)) continue;
      const referenceRoot = findTransparentExpressionRoot(reference.identifier);
      const parent = referenceRoot.parent;
      if (
        isNodeOfType(parent, "VariableDeclarator") &&
        parent.init === referenceRoot &&
        isNodeOfType(parent.id, "Identifier")
      ) {
        continue;
      }
      if (isNodeOfType(parent, "MemberExpression") && parent.object === referenceRoot) {
        const memberParent = parent.parent;
        if (isNodeOfType(memberParent, "AssignmentExpression") && memberParent.left === parent) {
          const propertyName = getStaticPropertyName(parent);
          const isNumericIndex =
            (propertyName !== null && /^\d+$/.test(propertyName)) ||
            (parent.computed &&
              isNodeOfType(parent.property, "Literal") &&
              typeof parent.property.value === "number" &&
              Number.isInteger(parent.property.value) &&
              parent.property.value >= 0);
          if (
            memberParent.operator === "=" &&
            isNumericIndex &&
            isDefinitelyNonRejectingArrayValue(memberParent.right, depth - 1, scopes)
          ) {
            continue;
          }
          return false;
        }
        if (
          isNodeOfType(memberParent, "CallExpression") &&
          memberParent.callee === parent &&
          getStaticPropertyName(parent) === "push"
        ) {
          if (
            !memberParent.arguments.every((argument) =>
              isDefinitelyNonRejectingArrayValue(argument, depth - 1, scopes),
            )
          ) {
            return false;
          }
          continue;
        }
        if (getStaticPropertyName(parent) === "length") continue;
        return false;
      }
      if (reference.flag !== "read") return false;
      if (isNodeOfType(parent, "CallExpression")) {
        if (getPromiseCombinatorMethodName(parent, scopes) === "all") continue;
        return false;
      }
      if (isNodeOfType(parent, "ReturnStatement")) return false;
    }
  }
  return true;
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

const getCustomIteratorFunction = (
  argument: EsTreeNode,
  scopes?: ScopeAnalysis,
): EsTreeNode | null => {
  if (!isNodeOfType(argument, "ObjectExpression")) return null;
  if (argument.properties.length !== 1) return null;
  const property = argument.properties[0];
  if (!isNodeOfType(property, "Property") || !property.computed) return null;
  const key = stripParenExpression(property.key);
  if (!isNodeOfType(key, "MemberExpression")) return null;
  const receiver = stripParenExpression(key.object);
  if (
    !isNodeOfType(receiver, "Identifier") ||
    receiver.name !== "Symbol" ||
    (scopes && !scopes.isGlobalReference(receiver)) ||
    getStaticPropertyName(key) !== "iterator"
  ) {
    return null;
  }
  const iteratorFunction = stripParenExpression(property.value);
  return isFunctionLike(iteratorFunction) ? iteratorFunction : null;
};

const isAllSettledArrayExpressionEvaluationSafe = (
  arrayExpression: EsTreeNodeOfType<"ArrayExpression">,
  scopes?: ScopeAnalysis,
): boolean =>
  arrayExpression.elements.every((element) => {
    if (element === null) return true;
    const value = stripParenExpression(element);
    if (isNodeOfType(value, "Literal")) return true;
    if (isNodeOfType(value, "TemplateLiteral")) return value.expressions.length === 0;
    if (isFunctionLike(value)) return true;
    if (isNodeOfType(value, "ArrayExpression")) {
      return isAllSettledArrayExpressionEvaluationSafe(value, scopes);
    }
    if (!scopes || !isNodeOfType(value, "Identifier")) return false;
    const symbol = scopes.symbolFor(value);
    return Boolean(
      symbol &&
      symbol.declarationNode.range[0] < value.range[0] &&
      symbol.references.every((reference) => reference.flag === "read"),
    );
  });

const isProvenLocalArrayBinding = (argument: EsTreeNode, scopes?: ScopeAnalysis): boolean => {
  if (!scopes || !isNodeOfType(argument, "Identifier")) return false;
  const symbol = scopes.symbolFor(argument);
  const initializer = symbol?.initializer ? stripParenExpression(symbol.initializer) : null;
  return Boolean(
    symbol?.kind === "const" &&
    isNodeOfType(initializer, "ArrayExpression") &&
    isAllSettledArrayExpressionEvaluationSafe(initializer, scopes) &&
    symbol.references.every(
      (reference) => reference.flag === "read" && reference.identifier === argument,
    ),
  );
};

const isProvenNonThrowingArrayFactoryCall = (
  argument: EsTreeNode,
  depth: number,
  scopes?: ScopeAnalysis,
): boolean => {
  if (!scopes || !isNodeOfType(argument, "CallExpression")) return false;
  const callee = stripParenExpression(argument.callee);
  if (!isNodeOfType(callee, "Identifier") || argument.arguments.length > 0) return false;
  const factory = resolveExactLocalFunction(callee, scopes);
  if (!isNodeOfType(factory, "ArrowFunctionExpression") || factory.async) return false;
  const factoryResult = stripParenExpression(factory.body);
  if (
    isNodeOfType(factoryResult, "BlockStatement") ||
    !isNodeOfType(factoryResult, "ArrayExpression") ||
    !isAllSettledArrayExpressionEvaluationSafe(factoryResult, scopes)
  ) {
    return false;
  }
  return (
    !subtreeCanThrowSynchronously(factory, factory, scopes) &&
    !helperHasUnhandledSynchronousCall(factory, depth, scopes)
  );
};

const isCustomIteratorExecutionProvenNonThrowing = (
  iteratorFunction: EsTreeNodeOfType<"FunctionExpression">,
  depth: number,
  scopes?: ScopeAnalysis,
): boolean => {
  if (iteratorFunction.async || iteratorFunction.params.length > 0) return false;
  let hasOpaqueOperation = false;
  walkOwnFunctionScope(iteratorFunction, (candidate) => {
    if (hasOpaqueOperation) return false;
    if (
      isNodeOfType(candidate, "MemberExpression") ||
      isNodeOfType(candidate, "SpreadElement") ||
      isNodeOfType(candidate, "NewExpression") ||
      isNodeOfType(candidate, "AwaitExpression") ||
      isNodeOfType(candidate, "TaggedTemplateExpression") ||
      isNodeOfType(candidate, "ForInStatement") ||
      isNodeOfType(candidate, "ForOfStatement") ||
      (isNodeOfType(candidate, "VariableDeclarator") &&
        (isNodeOfType(candidate.id, "ArrayPattern") ||
          isNodeOfType(candidate.id, "ObjectPattern"))) ||
      (isNodeOfType(candidate, "YieldExpression") && candidate.delegate)
    ) {
      hasOpaqueOperation = true;
      return false;
    }
  });
  if (hasOpaqueOperation) return false;
  return scopes
    ? !subtreeCanThrowSynchronously(iteratorFunction, iteratorFunction, scopes) &&
        !helperHasUnhandledSynchronousCall(iteratorFunction, depth, scopes)
    : !subtreeContainsThrow(iteratorFunction, false);
};

const isNeverRejectingPromiseCombinatorCall = (
  callNode: EsTreeNodeOfType<"CallExpression">,
  depth: number,
  scopes?: ScopeAnalysis,
): boolean => {
  const methodName = getPromiseCombinatorMethodName(callNode, scopes);
  if (methodName === "allSettled") {
    const argument = callNode.arguments[0] ? stripParenExpression(callNode.arguments[0]) : null;
    if (!argument) return false;
    if (isNodeOfType(argument, "ArrayExpression")) {
      return isAllSettledArrayExpressionEvaluationSafe(argument, scopes);
    }
    if (isProvenLocalArrayBinding(argument, scopes)) return true;
    if (isProvenNonThrowingArrayFactoryCall(argument, depth, scopes)) return true;
    if (isNodeOfType(argument, "Literal")) return typeof argument.value === "string";
    if (isNodeOfType(argument, "TemplateLiteral")) return argument.expressions.length === 0;
    const iteratorFunction = getCustomIteratorFunction(argument, scopes);
    if (!isNodeOfType(iteratorFunction, "FunctionExpression") || !iteratorFunction.generator) {
      return false;
    }
    return isCustomIteratorExecutionProvenNonThrowing(iteratorFunction, depth, scopes);
  }
  if (methodName !== "all") return false;
  const argument = callNode.arguments[0];
  if (!argument) return false;
  const stripped = stripParenExpression(argument);
  if (isNodeOfType(stripped, "ArrayExpression")) {
    return stripped.elements.every(
      (element) => element === null || isDefinitelyNonRejectingArrayValue(element, depth, scopes),
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
const isSyncArrayLiteralMethodCall = (
  callNode: EsTreeNodeOfType<"CallExpression">,
  scopes?: ScopeAnalysis,
): boolean => {
  const callee = stripParenExpression(callNode.callee);
  if (!isNodeOfType(callee, "MemberExpression") || callee.computed) return false;
  if (!isNodeOfType(callee.property, "Identifier")) return false;
  if (!SYNC_ARRAY_METHOD_NAMES.has(callee.property.name)) return false;
  const receiver = stripParenExpression(callee.object);
  if (!isNodeOfType(receiver, "ArrayExpression")) return false;
  return (callNode.arguments ?? []).every((argument) => {
    const strippedArgument = stripParenExpression(argument);
    if (!isFunctionLike(strippedArgument)) return !subtreeContainsThrow(strippedArgument);
    if (!scopes) return !subtreeContainsThrow(strippedArgument, false);
    return (
      !subtreeCanThrowSynchronously(strippedArgument, strippedArgument, scopes) &&
      !helperHasUnhandledSynchronousCall(
        strippedArgument,
        NEVER_REJECTING_ANALYSIS_MAX_DEPTH,
        scopes,
      )
    );
  });
};

const returnedExpressionCanReject = (
  expression: EsTreeNode,
  depth: number,
  scopes?: ScopeAnalysis,
): boolean => {
  const returned = stripParenExpression(expression);
  if (isNodeOfType(returned, "CallExpression")) {
    if (isSyncArrayLiteralMethodCall(returned, scopes)) return false;
    return !isNeverRejectingExpression(returned, depth, scopes);
  }
  if (isNodeOfType(returned, "NewExpression")) {
    const isPromiseConstruction =
      isNodeOfType(returned.callee, "Identifier") && returned.callee.name === "Promise";
    return isPromiseConstruction && !isNonRejectingPromiseConstruction(returned, scopes);
  }
  return false;
};
const getDirectThisMemberName = (expression: EsTreeNode): string | null => {
  const stripped = stripParenExpression(expression);
  if (!isNodeOfType(stripped, "MemberExpression")) return null;
  if (!isNodeOfType(stripParenExpression(stripped.object), "ThisExpression")) return null;
  return getStaticPropertyName(stripped);
};

const getClassMemberName = (member: EsTreeNode): string | null => {
  if (!isNodeOfType(member, "MethodDefinition") && !isNodeOfType(member, "PropertyDefinition")) {
    return null;
  }
  if (!member.computed && isNodeOfType(member.key, "Identifier")) return member.key.name;
  if (member.computed && isNodeOfType(member.key, "Literal")) {
    return typeof member.key.value === "string" ? member.key.value : null;
  }
  return null;
};

const resolveStableClassHelperFunction = (
  callNode: EsTreeNodeOfType<"CallExpression">,
): EsTreeNode | null => {
  const helperName = getDirectThisMemberName(callNode.callee);
  if (!helperName) return null;
  let classNode: EsTreeNode | null | undefined = callNode.parent;
  while (
    classNode &&
    !isNodeOfType(classNode, "ClassDeclaration") &&
    !isNodeOfType(classNode, "ClassExpression")
  ) {
    classNode = classNode.parent ?? null;
  }
  if (!classNode) return null;
  const matchingHelpers: EsTreeNode[] = [];
  for (const member of classNode.body.body) {
    if (getClassMemberName(member) !== helperName) continue;
    if (isNodeOfType(member, "MethodDefinition") && member.kind === "method") {
      matchingHelpers.push(member.value);
      continue;
    }
    if (
      isNodeOfType(member, "PropertyDefinition") &&
      member.value &&
      isFunctionLike(member.value)
    ) {
      matchingHelpers.push(member.value);
    }
  }
  if (matchingHelpers.length !== 1) return null;
  let isReassigned = false;
  walkAst(classNode, (candidate) => {
    if (isReassigned) return false;
    if (
      isNodeOfType(candidate, "AssignmentExpression") &&
      getDirectThisMemberName(candidate.left) === helperName
    ) {
      isReassigned = true;
      return false;
    }
    if (
      (isNodeOfType(candidate, "UpdateExpression") ||
        (isNodeOfType(candidate, "UnaryExpression") && candidate.operator === "delete")) &&
      getDirectThisMemberName(candidate.argument) === helperName
    ) {
      isReassigned = true;
      return false;
    }
  });
  return isReassigned ? null : matchingHelpers[0];
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
  return resolveStableClassHelperFunction(callNode);
};

const helperHasUnhandledSynchronousCall = (
  helper: EsTreeNode,
  depth: number,
  scopes?: ScopeAnalysis,
  visitedFunctions = new Set<EsTreeNode>(),
): boolean => {
  if (visitedFunctions.has(helper)) return false;
  visitedFunctions.add(helper);
  let hasUnhandledCall = false;
  walkOwnFunctionScope(helper, (child: EsTreeNode) => {
    if (hasUnhandledCall) return false;
    if (isNodeOfType(child, "NewExpression")) {
      if (
        !isNonRejectingPromiseConstruction(child, scopes) &&
        !isInsideNonRethrowingTry(child, helper)
      ) {
        hasUnhandledCall = true;
        return false;
      }
      return;
    }
    if (isNodeOfType(child, "MemberExpression")) {
      const parent = child.parent;
      if (isNodeOfType(parent, "CallExpression") && parent.callee === child) return;
      const receiver = stripParenExpression(child.object);
      const propertyName = getStaticPropertyName(child);
      let isKnownGetter = false;
      if (propertyName && isNodeOfType(receiver, "Identifier")) {
        const receiverInitializer = scopes?.symbolFor(receiver)?.initializer;
        const objectExpression = receiverInitializer
          ? stripParenExpression(receiverInitializer)
          : null;
        if (isNodeOfType(objectExpression, "ObjectExpression")) {
          isKnownGetter = objectExpression.properties.some(
            (property) =>
              isNodeOfType(property, "Property") &&
              property.kind === "get" &&
              ((isNodeOfType(property.key, "Identifier") && property.key.name === propertyName) ||
                (isNodeOfType(property.key, "Literal") && property.key.value === propertyName)),
          );
        }
      }
      if (propertyName && isNodeOfType(receiver, "ThisExpression")) {
        let classNode: EsTreeNode | null | undefined = helper.parent;
        while (
          classNode &&
          !isNodeOfType(classNode, "ClassDeclaration") &&
          !isNodeOfType(classNode, "ClassExpression")
        ) {
          classNode = classNode.parent ?? null;
        }
        isKnownGetter = Boolean(
          classNode?.body.body.some(
            (member) =>
              isNodeOfType(member, "MethodDefinition") &&
              member.kind === "get" &&
              getClassMemberName(member) === propertyName,
          ),
        );
      }
      if (isKnownGetter && !isInsideNonRethrowingTry(child, helper)) {
        hasUnhandledCall = true;
        return false;
      }
      return;
    }
    if (!isNodeOfType(child, "CallExpression")) return;
    let ancestor: EsTreeNode | null | undefined = child.parent;
    while (ancestor && ancestor !== helper) {
      if (isNodeOfType(ancestor, "AwaitExpression")) return;
      if (isNodeOfType(ancestor, "CallExpression")) return;
      if (isNodeOfType(ancestor, "ReturnStatement")) break;
      ancestor = ancestor.parent ?? null;
    }
    if (isInsideNonRethrowingTry(child, helper)) return;
    if (
      isPromiseResolveCall(child, scopes) ||
      chainCarriesRejectionHandler(child, scopes) ||
      isSyncArrayLiteralMethodCall(child, scopes) ||
      isThunkActionDispatchCall(child) ||
      isNeverRejectingPromiseCombinatorCall(child, depth, scopes)
    ) {
      return;
    }
    const callee = stripParenExpression(child.callee);
    if (
      scopes &&
      isNodeOfType(callee, "Identifier") &&
      isReactHookResultReference(callee, STATE_HOOK_NAMES, 1, scopes)
    ) {
      return;
    }
    if (
      isNodeOfType(callee, "Identifier") &&
      callee.name === "queueMicrotask" &&
      (!scopes || scopes.isGlobalReference(callee))
    ) {
      const callback = child.arguments[0];
      const resolvedCallback = callback
        ? isFunctionLike(stripParenExpression(callback))
          ? stripParenExpression(callback)
          : scopes
            ? resolveExactLocalFunction(callback, scopes)
            : null
        : null;
      if (resolvedCallback) return;
    }
    if (isNodeOfType(callee, "MemberExpression")) {
      const receiver = stripParenExpression(callee.object);
      if (
        isNodeOfType(receiver, "Identifier") &&
        receiver.name === "console" &&
        (!scopes || scopes.isGlobalReference(receiver))
      ) {
        return;
      }
      if (getStaticPropertyName(callee) === "push" && isNodeOfType(receiver, "Identifier")) {
        const receiverSymbol = scopes?.symbolFor(receiver);
        const receiverInitializer = receiverSymbol?.initializer
          ? stripParenExpression(receiverSymbol.initializer)
          : null;
        if (
          isNodeOfType(receiverInitializer, "ArrayExpression") &&
          receiverSymbol?.references.every((reference) => {
            const referenceRoot = findTransparentExpressionRoot(reference.identifier);
            const referenceMember = referenceRoot.parent;
            const assignment = referenceMember?.parent;
            return !(
              isNodeOfType(referenceMember, "MemberExpression") &&
              referenceMember.object === referenceRoot &&
              getStaticPropertyName(referenceMember) === "push" &&
              isNodeOfType(assignment, "AssignmentExpression") &&
              assignment.left === referenceMember
            );
          }) &&
          child.arguments.every((argument) => {
            const innerArgument = stripParenExpression(argument);
            return (
              isDefinitelyNonThenableValue(innerArgument) ||
              isNeverRejectingExpression(innerArgument, depth - 1, scopes)
            );
          })
        ) {
          return;
        }
      }
    }
    const localFunction =
      scopes && isNodeOfType(callee, "Identifier")
        ? resolveExactLocalFunction(callee, scopes)
        : null;
    if (scopes && localFunction && isFunctionLike(localFunction)) {
      if (localFunction.async) return;
      if (
        !subtreeCanThrowSynchronously(localFunction, localFunction, scopes) &&
        !helperHasUnhandledSynchronousCall(localFunction, depth - 1, scopes, visitedFunctions)
      ) {
        return;
      }
    }
    hasUnhandledCall = true;
    return false;
  });
  return hasUnhandledCall;
};

const isRejectionProofAsyncHelperBody = (
  helper: EsTreeNode,
  depth: number,
  scopes?: ScopeAnalysis,
): boolean => {
  if (scopes && subtreeCanThrowSynchronously(helper, helper, scopes)) return false;
  if (helperHasUnhandledSynchronousCall(helper, depth, scopes)) return false;
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
const budgetedCrossFileSpecifiers = new Set<string>();
let isAnalyzingForeignHelperBody = false;

const resolveCrossFileExportWithinBudget = (
  specifier: string,
  exportedName: string,
): ResolvedCrossFileExport | null => {
  if (!currentLintedFilename) return null;
  const memoKey = `${specifier}\u0000${exportedName}`;
  const memoized = crossFileResolutionMemo.get(memoKey);
  if (memoized !== undefined) return memoized;
  if (!budgetedCrossFileSpecifiers.has(specifier)) {
    if (crossFileResolutionsRemaining <= 0) return null;
    crossFileResolutionsRemaining -= 1;
    budgetedCrossFileSpecifiers.add(specifier);
  }
  const resolved = resolveCrossFileExport(currentLintedFilename, specifier, exportedName);
  crossFileResolutionMemo.set(memoKey, resolved);
  return resolved;
};

const isStableForeignHelper = (helper: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const declaration = helper.parent;
  if (isNodeOfType(helper, "FunctionDeclaration")) {
    if (!helper.id) return false;
    const symbol = scopes.scopeFor(helper).symbolsByName.get(helper.id.name);
    return Boolean(symbol && symbol.references.every((reference) => reference.flag === "read"));
  }
  if (!isNodeOfType(declaration, "VariableDeclarator")) return true;
  const variableDeclaration = declaration.parent;
  if (
    !isNodeOfType(variableDeclaration, "VariableDeclaration") ||
    variableDeclaration.kind !== "const"
  ) {
    return false;
  }
  const binding = isNodeOfType(declaration.id, "Identifier")
    ? scopes.symbolFor(declaration.id)
    : null;
  return Boolean(binding && binding.references.every((reference) => reference.flag === "read"));
};

const isRejectionProofForeignHelperBody = (
  helper: EsTreeNode,
  depth: number,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isStableForeignHelper(helper, scopes)) return false;
  isAnalyzingForeignHelperBody = true;
  try {
    return isRejectionProofAsyncHelperBody(helper, depth, scopes);
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
  const foreignScopes = analyzeScopes(resolved.programNode);
  const foreignHelper = getUseCallbackWrappedFunction(resolved.node, foreignScopes, true);
  if (!isFunctionLike(foreignHelper) || !foreignHelper.async) return false;
  if (!isStableForeignHelper(resolved.node, foreignScopes)) return false;
  return isRejectionProofForeignHelperBody(foreignHelper, depth, foreignScopes);
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
  scopes: ScopeAnalysis,
): EsTreeNodeOfType<"ObjectExpression"> | null => {
  const unwrapReturnedExpression = (expression: EsTreeNode): EsTreeNode | null => {
    const stripped = stripParenExpression(expression);
    if (isNodeOfType(stripped, "ObjectExpression")) return stripped;
    if (!isNodeOfType(stripped, "CallExpression")) return null;
    if (
      !isReactApiCall(stripped, "useMemo", scopes, {
        allowGlobalReactNamespace: true,
        resolveNamedAliases: true,
      })
    ) {
      return null;
    }
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
  scopes: ScopeAnalysis,
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
    const symbol = scopes.symbolFor(value);
    if (
      !symbol ||
      symbol.kind !== "const" ||
      symbol.references.some((reference) => reference.flag !== "read")
    ) {
      return null;
    }
    const binding = findVariableInitializer(value, value.name);
    if (!binding?.initializer) return null;
    return getUseCallbackWrappedFunction(binding.initializer, scopes, true);
  }
  return null;
};

const HOOK_NAME_PATTERN = /^use[A-Z0-9]/;
const isNeverRejectingImportedHookFunctionCall = (
  callee: EsTreeNodeOfType<"Identifier">,
  depth: number,
  consumerScopes: ScopeAnalysis,
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
  const variableDeclaration = declarator.parent;
  if (
    !isNodeOfType(variableDeclaration, "VariableDeclaration") ||
    variableDeclaration.kind !== "const"
  ) {
    return false;
  }
  const consumerBinding = consumerScopes.symbolFor(callee);
  if (
    !consumerBinding ||
    consumerBinding.references.some((reference) => reference.flag !== "read")
  ) {
    return false;
  }
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
  const foreignScopes = analyzeScopes(resolved.programNode);
  const hookFunction = getUseCallbackWrappedFunction(resolved.node, foreignScopes, true);
  if (!isStableForeignHelper(resolved.node, foreignScopes)) return false;
  const returnedObject = getHookReturnedObjectExpression(hookFunction, foreignScopes);
  if (!returnedObject) return false;
  const returnedFunction = resolveHookReturnedFunctionProperty(
    returnedObject,
    propertyName,
    foreignScopes,
  );
  if (!returnedFunction || !isFunctionLike(returnedFunction) || !returnedFunction.async) {
    return false;
  }
  return isRejectionProofForeignHelperBody(returnedFunction, depth, foreignScopes);
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
  return scopes ? isNeverRejectingImportedHookFunctionCall(callee, depth, scopes) : false;
};

const isNeverRejectingExpression = (
  expression: EsTreeNode,
  depth: number,
  scopes?: ScopeAnalysis,
): boolean => {
  const inner = stripParenExpression(expression);
  if (isDefinitelyNonThenableValue(inner)) return true;
  if (isNonRejectingPromiseConstruction(inner, scopes)) return true;
  if (!isNodeOfType(inner, "CallExpression")) return false;
  if (isPromiseResolveCall(inner, scopes)) return true;
  if (isThunkActionDispatchCall(inner)) return true;
  if (chainCarriesRejectionHandler(inner, scopes)) return true;
  if (isNeverRejectingPromiseCombinatorCall(inner, depth, scopes)) return true;
  const sameFileHelper = resolveSameFileHelperFunction(inner, scopes);
  if (sameFileHelper && isFunctionLike(sameFileHelper)) {
    if (sameFileHelper.async) {
      return isRejectionProofAsyncHelperBody(sameFileHelper, depth, scopes);
    }
    return (
      !helperHasUnhandledSynchronousCall(sameFileHelper, depth, scopes) &&
      isNeverRejectingHelperCall(inner, scopes)
    );
  }
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
  setterKey: string,
  context: RuleContext,
  doesContinuingPathReachReset: boolean,
): boolean => {
  const expressionUnconditionallyClearsFlag = (expression: EsTreeNode): boolean => {
    const stripped = stripParenExpression(expression);
    if (isNodeOfType(stripped, "CallExpression")) {
      const setter = getSetterBooleanValue(stripped, context);
      if (setter?.setterKey === setterKey && !setter.value) return true;
      const helper = resolveSameFileHelperFunction(stripped, context.scopes);
      if (!helper || !isFunctionLike(helper) || helper.async) return false;
      let clearsUnconditionally = false;
      walkOwnFunctionScope(helper, (child: EsTreeNode) => {
        if (!isNodeOfType(child, "CallExpression")) return;
        const helperSetter = getSetterBooleanValue(child, context);
        if (
          helperSetter?.setterKey === setterKey &&
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
      subtreeHasAbruptSynchronousOperation(stripped, functionNode, context) &&
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
  setterKey: string,
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
        !catchHandlerCanBypassReset(cursor.handler, functionNode, setterKey, context, true)
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

const REACT_SETTER_CALLEE_PATTERN = /^set[A-Z]/;
const isProvenNonThrowingSynchronousCall = (
  callNode: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): boolean => {
  const callee = stripParenExpression(callNode.callee);
  if (isNodeOfType(callee, "Identifier")) {
    if (
      isReactHookResultReference(callee, STATE_HOOK_NAMES, 1, context.scopes) ||
      (context.scopes.isGlobalReference(callee) && REACT_SETTER_CALLEE_PATTERN.test(callee.name))
    ) {
      return true;
    }
    const localFunction = resolveExactLocalFunction(callee, context.scopes);
    if (localFunction && isFunctionLike(localFunction) && !localFunction.async) {
      return (
        !subtreeCanThrowSynchronously(localFunction, localFunction, context.scopes) &&
        !helperHasUnhandledSynchronousCall(
          localFunction,
          NEVER_REJECTING_ANALYSIS_MAX_DEPTH,
          context.scopes,
        )
      );
    }
    return false;
  }
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  const receiver = stripParenExpression(callee.object);
  return Boolean(
    isNodeOfType(receiver, "Identifier") &&
    receiver.name === "console" &&
    context.scopes.isGlobalReference(receiver),
  );
};

const subtreeHasAbruptSynchronousOperation = (
  root: EsTreeNode,
  functionBoundary: EsTreeNode,
  context: RuleContext,
): boolean => {
  let canCompleteAbruptly = false;
  walkAst(root, (candidate) => {
    if (canCompleteAbruptly) return false;
    if (candidate !== root && isFunctionLike(candidate)) return false;
    if (isInsideNonRethrowingTry(candidate, functionBoundary)) return;
    if (isNodeOfType(candidate, "ThrowStatement") || isNodeOfType(candidate, "NewExpression")) {
      canCompleteAbruptly = true;
      return false;
    }
    if (
      isNodeOfType(candidate, "CallExpression") &&
      !isProvenNonThrowingSynchronousCall(candidate, context)
    ) {
      canCompleteAbruptly = true;
      return false;
    }
  });
  return canCompleteAbruptly;
};

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
    if (isNodeOfType(child, "NewExpression")) {
      hasAbruptCompletion = true;
      return false;
    }
    if (
      isNodeOfType(child, "CallExpression") &&
      !isProvenNonThrowingSynchronousCall(child, context)
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

const isInitiallyActiveLifecycleGuard = (guard: EsTreeNode, context: RuleContext): boolean => {
  const expression = stripParenExpression(guard);
  if (isNodeOfType(expression, "Identifier")) {
    const binding = findVariableInitializer(expression, expression.name);
    const initializer = binding?.initializer ? stripParenExpression(binding.initializer) : null;
    return Boolean(
      initializer && isNodeOfType(initializer, "Literal") && initializer.value === true,
    );
  }
  if (
    !isNodeOfType(expression, "MemberExpression") ||
    getStaticPropertyName(expression) !== "current"
  ) {
    return false;
  }
  const receiver = stripParenExpression(expression.object);
  if (!isNodeOfType(receiver, "Identifier")) return false;
  const binding = findVariableInitializer(receiver, receiver.name);
  const initializer = binding?.initializer ? stripParenExpression(binding.initializer) : null;
  const initialValue =
    initializer && isNodeOfType(initializer, "CallExpression") ? initializer.arguments[0] : null;
  return Boolean(
    initializer &&
    isNodeOfType(initializer, "CallExpression") &&
    isReactApiCall(initializer, USE_REF_HOOK_NAMES, context.scopes, {
      allowGlobalReactNamespace: true,
      allowUnboundBareCalls: true,
    }) &&
    initialValue &&
    isNodeOfType(initialValue, "Literal") &&
    initialValue.value === true,
  );
};

const isInsideTryFinalizer = (
  node: EsTreeNode,
  tryStatement: EsTreeNodeOfType<"TryStatement">,
): boolean => {
  let cursor: EsTreeNode | null | undefined = node;
  while (cursor && cursor !== tryStatement) {
    if (cursor === tryStatement.finalizer) return true;
    cursor = cursor.parent ?? null;
  }
  return false;
};

const hasLifecycleGuardWriteOutsideCleanup = (
  effectCallback: EsTreeNode,
  guardKey: string,
  acceptedCleanupAssignments: ReadonlySet<EsTreeNode>,
  context: RuleContext,
): boolean => {
  let didFindOtherWrite = false;
  walkAst(effectCallback, (candidate) => {
    if (didFindOtherWrite) return false;
    if (isNodeOfType(candidate, "AssignmentExpression")) {
      if (
        serializeReferenceKey({ node: candidate.left, scopes: context.scopes }) === guardKey &&
        !acceptedCleanupAssignments.has(candidate)
      ) {
        didFindOtherWrite = true;
        return false;
      }
      return;
    }
    if (
      (isNodeOfType(candidate, "UpdateExpression") ||
        (isNodeOfType(candidate, "UnaryExpression") && candidate.operator === "delete")) &&
      serializeReferenceKey({ node: candidate.argument, scopes: context.scopes }) === guardKey
    ) {
      didFindOtherWrite = true;
      return false;
    }
  });
  return didFindOtherWrite;
};

const isResetGuardedByCleanupBackedLifecycle = (
  resetNode: EsTreeNode,
  functionNode: EsTreeNode,
  context: RuleContext,
): boolean => {
  let child = resetNode;
  let cursor: EsTreeNode | null | undefined = resetNode.parent;
  let guardKey: string | null = null;
  let guardExpression: EsTreeNode | null = null;
  while (cursor && cursor !== functionNode) {
    if (
      isNodeOfType(cursor, "IfStatement") &&
      cursor.consequent === child &&
      cursor.alternate === null
    ) {
      guardExpression = cursor.test;
      guardKey = serializeReferenceKey({ node: cursor.test, scopes: context.scopes });
      break;
    }
    child = cursor;
    cursor = cursor.parent ?? null;
  }
  if (!guardKey || !guardExpression || !isInitiallyActiveLifecycleGuard(guardExpression, context)) {
    return false;
  }

  cursor = functionNode.parent;
  while (cursor) {
    if (isFunctionLike(cursor)) {
      const callbackRoot = findTransparentExpressionRoot(cursor);
      const callbackCall = callbackRoot.parent;
      const isEffectCallback = Boolean(
        callbackCall &&
        isNodeOfType(callbackCall, "CallExpression") &&
        callbackCall.arguments[0] === callbackRoot &&
        isReactApiCall(callbackCall, EFFECT_HOOK_NAMES, context.scopes, {
          allowGlobalReactNamespace: true,
          allowUnboundBareCalls: true,
        }),
      );
      if (isEffectCallback) {
        const acceptedCleanupAssignments = new Set<EsTreeNode>();
        for (const cleanupFunction of collectReturnedCleanupFunctions(cursor, context.scopes)) {
          walkOwnFunctionScope(cleanupFunction, (cleanupNode) => {
            const assignedValue = isNodeOfType(cleanupNode, "AssignmentExpression")
              ? stripParenExpression(cleanupNode.right)
              : null;
            if (
              !isNodeOfType(cleanupNode, "AssignmentExpression") ||
              cleanupNode.operator !== "=" ||
              !isNodeOfType(assignedValue, "Literal") ||
              assignedValue.value !== false ||
              serializeReferenceKey({ node: cleanupNode.left, scopes: context.scopes }) !==
                guardKey ||
              !isUnconditionallyExecutedWithinFunction(cleanupNode, cleanupFunction, context)
            ) {
              return;
            }
            acceptedCleanupAssignments.add(cleanupNode);
          });
        }
        if (
          acceptedCleanupAssignments.size > 0 &&
          !hasLifecycleGuardWriteOutsideCleanup(
            cursor,
            guardKey,
            acceptedCleanupAssignments,
            context,
          )
        ) {
          return true;
        }
      }
    }
    cursor = cursor.parent ?? null;
  }
  return false;
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
  const settersByKey = new Map<string, SetterCall[]>();
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
      const list = settersByKey.get(helperSetter.setterKey) ?? [];
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
      settersByKey.set(helperSetter.setterKey, list);
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
    const list = settersByKey.get(setter.setterKey) ?? [];
    const protection = getExceptionalResetProtection(node, functionNode, context);
    list.push({
      value: setter.value,
      start,
      context: classifyResetContext(node, functionNode),
      node,
      ...protection,
    });
    settersByKey.set(setter.setterKey, list);
  });

  if (awaitSites.length === 0) return;
  const rejectingAwaitNodes = new Set(
    awaitSites
      .filter((awaitSite) => !isNeverRejectingAwaitedExpression(awaitSite.node, context.scopes))
      .map((awaitSite) => awaitSite.node),
  );

  for (const [setterKey, calls] of settersByKey) {
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
        call.protectingTry !== null &&
        !(
          isInsideTryFinalizer(call.node, call.protectingTry) &&
          isResetGuardedByCleanupBackedLifecycle(call.node, functionNode, context)
        ),
    );
    for (const reset of conditionalExceptionalResets) {
      const catchHandler = reset.protectingTry?.handler;
      if (
        catchHandler &&
        !catchHandlerCanBypassReset(catchHandler, functionNode, setterKey, context, false)
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
              setterKey,
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
    budgetedCrossFileSpecifiers.clear();
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
