import type { FunctionCfg } from "../../semantic/control-flow-graph.js";
import { analyzeScopes } from "../../semantic/scope-analysis.js";
import { MUTATING_COLLECTION_METHODS, PROMISE_SETTLE_METHODS } from "../../constants/js.js";
import { SAFE_MUTABLE_CONSTRUCTOR_NAMES } from "../../constants/library.js";
import {
  OBJECT_PROPERTY_MUTATION_METHOD_NAMES,
  REFLECT_PROPERTY_MUTATION_METHOD_NAMES,
} from "../../constants/mutation-methods.js";
import {
  STATE_UPDATER_CALL_PROPERTY_WRITE_RANK,
  STATE_UPDATER_INITIAL_PROPERTY_WRITE_RANK,
  STATE_UPDATER_INVOCATION_PROPERTY_WRITE_RANK,
} from "../../constants/react.js";
import { CROSS_FILE_BARREL_FOLLOW_DEPTH } from "../../constants/thresholds.js";
import { collectConstAliasSymbols } from "../../utils/collect-const-alias-symbols.js";
import { collectSynchronouslyInvokedLocalFunctions } from "../../utils/collect-effect-invoked-functions.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findDeferredExecutionBoundary } from "../../utils/find-deferred-execution-boundary.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { findReExportTargetsForName } from "../../utils/find-exported-function-body.js";
import { findProgramRoot } from "../../utils/find-program-root.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { getDestructuredBindingPropertyName } from "../../utils/get-destructured-binding-property-name.js";
import { getDirectUnreassignedInitializer } from "../../utils/get-direct-unreassigned-initializer.js";
import { getPropertyDescriptorValue } from "../../utils/get-property-descriptor-value.js";
import { getRuntimeStaticDependencySource } from "../../utils/get-runtime-static-dependency-source.js";
import { getStaticObjectPropertyValue } from "../../utils/get-static-object-property-value.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { getSymbolMutationInspector } from "../../utils/get-symbol-mutation-inspector.js";
import { getTransparentReactCallbackWrapperArgument } from "../../utils/get-transparent-react-callback-wrapper-argument.js";
import { hasPossibleStaticPropertyMutationOrEscape } from "../../utils/has-static-property-write-before.js";
import { isAstDescendant } from "../../utils/is-ast-descendant.js";
import { isCpuTypedArray } from "../../utils/is-cpu-typed-array.js";
import { isDefinitelyFalsyExpression } from "../../utils/is-definitely-falsy-expression.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOnUnconditionalPath } from "../../utils/is-node-on-unconditional-path.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isNullishExpression } from "../../utils/is-nullish-expression.js";
import { isResultDiscardedCall } from "../../utils/is-result-discarded-call.js";
import { parseSourceFile } from "../../utils/parse-source-file.js";
import { resolveConstIdentifierAlias } from "../../utils/resolve-const-identifier-alias.js";
import { resolveCrossFileValueExportWithFilePath } from "../../utils/resolve-cross-file-function-export.js";
import { resolveImportedApiReference } from "../../utils/resolve-imported-api-reference.js";
import { resolveModulePath } from "../../utils/resolve-module-path.js";
import { resolveReactUseStatePair } from "../../utils/resolve-react-use-state-pair.js";
import { resolveStaticLocalCallFunction } from "../../utils/get-order-independent-local-function.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
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
  /^(?:analytics|capture|dispatch|emit|log|notify|persist|record|report|save|send|submit|track)/;
const ASYNC_UPDATE_CALL_NAME_PATTERN = /^update[A-Z_]/;
const CALLBACK_PROP_NAME_PATTERN = /^(?:on|set)[A-Z]/;
const SAFE_GLOBAL_RECEIVER_NAMES = new Set(["Math", "JSON", "Object", "Array"]);
const PLATFORM_APPEND_CONSTRUCTOR_NAMES = new Set(["FormData", "Headers", "URLSearchParams"]);
const FRESH_CONTAINER_CONSTRUCTOR_NAMES = new Set([
  "Array",
  "DataView",
  "Date",
  "Object",
  ...SAFE_MUTABLE_CONSTRUCTOR_NAMES,
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
const INTERNATIONALIZED_DATE_IMMUTABLE_METHOD_NAMES = new Set(["add", "set"]);
const DAYJS_IMMUTABLE_METHOD_NAMES = new Set(["add", "set"]);
const DAYJS_MODULE_NAME = "dayjs";
const DAYJS_SINGLETON_MODULE_NAMES = new Set([DAYJS_MODULE_NAME]);
const DAYJS_BAD_MUTABLE_MODULE_NAME = "dayjs/plugin/badMutable";
const DAYJS_BAD_MUTABLE_MODULE_NAMES = new Set([
  DAYJS_BAD_MUTABLE_MODULE_NAME,
  `${DAYJS_BAD_MUTABLE_MODULE_NAME}.js`,
]);
const DAYJS_STATIC_FACTORY_METHOD_NAMES = new Set(["unix", "utc"]);
const OBJECT_DEFINE_PROPERTY_METHOD_NAMES = new Set(["defineProperty"]);
const programsActivatingDayjsBadMutable = new WeakSet<EsTreeNode>();

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

const exportedNameResolvesToDefaultImport = (
  program: EsTreeNode,
  filename: string,
  exportedName: string,
  moduleNames: ReadonlySet<string>,
  visitedFilePaths: Set<string>,
  depth: number,
): boolean => {
  if (depth >= CROSS_FILE_BARREL_FOLLOW_DEPTH) return false;
  const reExportTargets = findReExportTargetsForName(program, exportedName);
  if (reExportTargets.length !== 1) return false;
  const reExportTarget = reExportTargets[0];
  if (!reExportTarget) return false;
  if (reExportTarget.importedName === "default" && moduleNames.has(reExportTarget.source)) {
    return true;
  }
  const reExportedFilePath = resolveModulePath(filename, reExportTarget.source);
  if (!reExportedFilePath || visitedFilePaths.has(reExportedFilePath)) return false;
  visitedFilePaths.add(reExportedFilePath);
  const reExportedProgram = parseSourceFile(reExportedFilePath);
  return Boolean(
    reExportedProgram &&
    exportedNameResolvesToDefaultImport(
      reExportedProgram,
      reExportedFilePath,
      reExportTarget.importedName,
      moduleNames,
      visitedFilePaths,
      depth + 1,
    ),
  );
};

const expressionResolvesToDefaultImport = (
  expression: EsTreeNode,
  scopes: RuleContext["scopes"],
  moduleNames: ReadonlySet<string>,
  filename?: string,
  visitedFilePaths: Set<string> = new Set(),
): boolean => {
  const importedReference = resolveImportedApiReference(expression, scopes);
  if (!importedReference || importedReference.isNamespace) return false;
  if (moduleNames.has(importedReference.source) && importedReference.importedName === "default") {
    return true;
  }
  if (!filename || importedReference.importedName === null) return false;
  const resolvedExport = resolveCrossFileValueExportWithFilePath(
    filename,
    importedReference.source,
    importedReference.importedName,
  );
  if (resolvedExport) {
    if (visitedFilePaths.has(resolvedExport.filePath)) return false;
    visitedFilePaths.add(resolvedExport.filePath);
    return expressionResolvesToDefaultImport(
      resolvedExport.exportedNode,
      analyzeScopes(resolvedExport.programNode),
      moduleNames,
      resolvedExport.filePath,
      visitedFilePaths,
    );
  }
  const importedFilePath = resolveModulePath(filename, importedReference.source);
  if (!importedFilePath || visitedFilePaths.has(importedFilePath)) return false;
  visitedFilePaths.add(importedFilePath);
  const importedProgram = parseSourceFile(importedFilePath);
  return Boolean(
    importedProgram &&
    exportedNameResolvesToDefaultImport(
      importedProgram,
      importedFilePath,
      importedReference.importedName,
      moduleNames,
      visitedFilePaths,
      0,
    ),
  );
};

const programActivatesDayjsBadMutable = (
  program: EsTreeNode,
  scopes: RuleContext["scopes"],
  filename?: string,
  minimumDepthByFilePath: Map<string, number> = new Map(),
  unresolvedFrontierFilePaths: Set<string> = new Set(),
  depth: number = 0,
): boolean | null => {
  if (programsActivatingDayjsBadMutable.has(program)) return true;
  if (filename) {
    const previousDepth = minimumDepthByFilePath.get(filename);
    if (previousDepth !== undefined && previousDepth <= depth) {
      return unresolvedFrontierFilePaths.size > 0 ? null : false;
    }
    minimumDepthByFilePath.set(filename, depth);
    unresolvedFrontierFilePaths.delete(filename);
  }
  const executedLocalFunctions = collectSynchronouslyInvokedLocalFunctions(program, scopes);
  let isBadMutableActivated = false;
  walkAst(program, (node) => {
    if (isBadMutableActivated) return false;
    if (!isNodeOfType(node, "CallExpression")) return;
    const executionBoundary = findDeferredExecutionBoundary(node);
    if (executionBoundary && !executedLocalFunctions.has(executionBoundary)) return;
    const callee = stripParenExpression(node.callee);
    if (!isNodeOfType(callee, "MemberExpression") || getStaticPropertyName(callee) !== "extend") {
      return;
    }
    const receiver = stripParenExpression(callee.object);
    if (
      !expressionResolvesToDefaultImport(receiver, scopes, DAYJS_SINGLETON_MODULE_NAMES, filename)
    ) {
      return;
    }
    const pluginArgument = node.arguments?.[0];
    if (!pluginArgument || isNodeOfType(pluginArgument, "SpreadElement")) return;
    isBadMutableActivated = expressionResolvesToDefaultImport(
      pluginArgument,
      scopes,
      DAYJS_BAD_MUTABLE_MODULE_NAMES,
      filename,
    );
  });
  if (isBadMutableActivated || !filename || !isNodeOfType(program, "Program")) {
    if (isBadMutableActivated) programsActivatingDayjsBadMutable.add(program);
    return isBadMutableActivated;
  }
  for (const statement of program.body ?? []) {
    const dependencySource = getRuntimeStaticDependencySource(statement);
    if (!dependencySource) continue;
    const dependencyFilePath = resolveModulePath(filename, dependencySource);
    if (!dependencyFilePath) continue;
    const dependencyDepth = depth + 1;
    const previousDependencyDepth = minimumDepthByFilePath.get(dependencyFilePath);
    if (previousDependencyDepth !== undefined && previousDependencyDepth <= dependencyDepth) {
      continue;
    }
    if (depth >= CROSS_FILE_BARREL_FOLLOW_DEPTH) {
      unresolvedFrontierFilePaths.add(dependencyFilePath);
      continue;
    }
    const dependencyProgram = parseSourceFile(dependencyFilePath);
    if (!dependencyProgram) continue;
    const dependencyActivation = programActivatesDayjsBadMutable(
      dependencyProgram,
      analyzeScopes(dependencyProgram),
      dependencyFilePath,
      minimumDepthByFilePath,
      unresolvedFrontierFilePaths,
      dependencyDepth,
    );
    if (dependencyActivation) {
      programsActivatingDayjsBadMutable.add(program);
      return true;
    }
  }
  return unresolvedFrontierFilePaths.size > 0 ? null : false;
};

const expressionResolvesToDayjsFactory = (
  expression: EsTreeNode,
  scopes: RuleContext["scopes"],
  filename?: string,
  visitedFilePaths: Set<string> = new Set(),
  depth: number = 0,
): boolean => {
  if (depth > CROSS_FILE_BARREL_FOLLOW_DEPTH) return false;
  const currentProgram = findProgramRoot(expression);
  if (!currentProgram) return false;
  if (filename) {
    if (visitedFilePaths.has(filename)) return false;
    visitedFilePaths.add(filename);
  }
  if (programActivatesDayjsBadMutable(currentProgram, scopes, filename) !== false) return false;
  const importedReference = resolveImportedApiReference(expression, scopes);
  if (!importedReference || importedReference.isNamespace) {
    return false;
  }
  if (
    importedReference.source === DAYJS_MODULE_NAME &&
    (importedReference.importedName === "default" ||
      DAYJS_STATIC_FACTORY_METHOD_NAMES.has(importedReference.importedName ?? ""))
  ) {
    return true;
  }
  if (!filename || importedReference.importedName === null) return false;
  const resolvedExport = resolveCrossFileValueExportWithFilePath(
    filename,
    importedReference.source,
    importedReference.importedName,
  );
  if (!resolvedExport) return false;
  const wrapperScopes = analyzeScopes(resolvedExport.programNode);
  return expressionResolvesToDayjsFactory(
    resolvedExport.exportedNode,
    wrapperScopes,
    resolvedExport.filePath,
    new Set(visitedFilePaths),
    depth + 1,
  );
};

const importedReferenceIsDayjsFactory = (expression: EsTreeNode, context: RuleContext): boolean =>
  expressionResolvesToDayjsFactory(expression, context.scopes, context.filename);

const newExpressionIsInternationalizedCalendarDateTime = (
  expression: EsTreeNodeOfType<"NewExpression">,
  context: RuleContext,
): boolean => {
  const importedReference = resolveImportedApiReference(expression.callee, context.scopes);
  return Boolean(
    importedReference &&
    importedReference.source === "@internationalized/date" &&
    importedReference.importedName === "CalendarDateTime" &&
    !importedReference.isNamespace,
  );
};

const getUpdaterParameterSymbol = (updaterFunction: EsTreeNode, context: RuleContext) => {
  if (!isFunctionLike(updaterFunction)) return null;
  const firstParameter = updaterFunction.params?.[0];
  if (!firstParameter) return null;
  const binding = isNodeOfType(firstParameter, "AssignmentPattern")
    ? firstParameter.left
    : firstParameter;
  return isNodeOfType(binding, "Identifier") ? context.scopes.symbolFor(binding) : null;
};

const receiverRootIsUpdaterParameter = (
  expression: EsTreeNode,
  updaterFunction: EsTreeNode,
  context: RuleContext,
): boolean => {
  const rootIdentifier = baseReceiverIdentifier(expression);
  const updaterParameterSymbol = getUpdaterParameterSymbol(updaterFunction, context);
  return Boolean(
    rootIdentifier &&
    updaterParameterSymbol &&
    resolveConstIdentifierAlias(rootIdentifier, context.scopes)?.id === updaterParameterSymbol.id,
  );
};

const resolveDirectUnreassignedExpression = (
  expression: EsTreeNode,
  scopes: RuleContext["scopes"],
  visitedSymbolIds: Set<number> = new Set(),
): EsTreeNode => {
  const candidate = stripParenExpression(expression);
  if (!isNodeOfType(candidate, "Identifier")) return candidate;
  const symbol = scopes.symbolFor(candidate);
  if (!symbol || visitedSymbolIds.has(symbol.id)) return candidate;
  const initializer = getDirectUnreassignedInitializer(symbol);
  if (!initializer) return candidate;
  visitedSymbolIds.add(symbol.id);
  return resolveDirectUnreassignedExpression(initializer, scopes, visitedSymbolIds);
};

const hasPriorStateSetterCall = (
  setterCall: EsTreeNodeOfType<"CallExpression">,
  setterSymbolId: number,
  context: RuleContext,
): boolean => {
  const program = findProgramRoot(setterCall);
  if (!program) return true;
  const setterBoundary = findDeferredExecutionBoundary(setterCall);
  let hasPriorCall = false;
  walkAst(program, (node) => {
    if (
      hasPriorCall ||
      node.range[0] >= setterCall.range[0] ||
      !isNodeOfType(node, "CallExpression") ||
      findDeferredExecutionBoundary(node) !== setterBoundary ||
      isStaticallyUnreachable(node, setterBoundary ?? program)
    ) {
      return;
    }
    const callee = stripParenExpression(node.callee);
    if (!isNodeOfType(callee, "Identifier")) return;
    hasPriorCall =
      resolveReactUseStatePair(callee, context.scopes)?.setterSymbol.id === setterSymbolId;
  });
  return hasPriorCall;
};

const getStateInitialValues = (
  setterCall: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): EsTreeNode[] | null => {
  const setter = stripParenExpression(setterCall.callee);
  if (!isNodeOfType(setter, "Identifier")) return null;
  const pair = resolveReactUseStatePair(setter, context.scopes);
  if (!pair || !isNodeOfType(pair.declarator.init, "CallExpression")) return null;
  if (hasPriorStateSetterCall(setterCall, pair.setterSymbol.id, context)) return null;
  const initialValueArgument = pair.declarator.init.arguments?.[0];
  if (!initialValueArgument || isNodeOfType(initialValueArgument, "SpreadElement")) return null;
  const initialValue = stripParenExpression(initialValueArgument);
  const lazyInitializer = resolveLocalFunction(initialValue, context);
  if (lazyInitializer && (!isFunctionLike(lazyInitializer) || lazyInitializer.async)) return null;
  return lazyInitializer ? collectFunctionReturnValues(lazyInitializer) : [initialValue];
};

const getStateMemberInitialValues = (
  expression: EsTreeNodeOfType<"MemberExpression">,
  updaterFunction: EsTreeNode,
  setterCall: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): EsTreeNode[] | null => {
  const propertyName = getStaticPropertyKeyName(expression, {
    allowComputedString: true,
    stringifyNonStringLiterals: true,
  });
  const receiver = stripParenExpression(expression.object);
  const updaterParameterSymbol = getUpdaterParameterSymbol(updaterFunction, context);
  if (
    propertyName === null ||
    !isNodeOfType(receiver, "Identifier") ||
    !updaterParameterSymbol ||
    resolveConstIdentifierAlias(receiver, context.scopes)?.id !== updaterParameterSymbol.id
  ) {
    return null;
  }
  const possibleInitialValues = getStateInitialValues(setterCall, context);
  if (!possibleInitialValues) return null;
  const memberInitialValues: EsTreeNode[] = [];
  for (const possibleInitialValue of possibleInitialValues) {
    const stateValue = stripParenExpression(possibleInitialValue);
    if (isNodeOfType(stateValue, "ArrayExpression")) {
      const arrayIndex = Number(propertyName);
      if (!Number.isSafeInteger(arrayIndex) || arrayIndex < 0) return null;
      const memberInitialValue = stateValue.elements[arrayIndex];
      if (!memberInitialValue || isNodeOfType(memberInitialValue, "SpreadElement")) return null;
      memberInitialValues.push(memberInitialValue);
      continue;
    }
    if (!isNodeOfType(stateValue, "ObjectExpression")) return null;
    let memberInitialValue: EsTreeNode | null = null;
    for (const property of stateValue.properties.toReversed()) {
      if (!isNodeOfType(property, "Property") || property.kind !== "init") return null;
      const candidatePropertyName = getStaticPropertyKeyName(property);
      if (candidatePropertyName === null) return null;
      if (candidatePropertyName === propertyName) {
        memberInitialValue = property.value;
        break;
      }
    }
    if (!memberInitialValue) return null;
    memberInitialValues.push(memberInitialValue);
  }
  return memberInitialValues;
};

const expressionIsInternationalizedCalendarDateTime = (
  expression: EsTreeNode,
  updaterFunction: EsTreeNode,
  setterCall: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): boolean => {
  const candidate = resolveDirectUnreassignedExpression(expression, context.scopes);
  if (
    isNodeOfType(candidate, "NewExpression") &&
    newExpressionIsInternationalizedCalendarDateTime(candidate, context)
  ) {
    return true;
  }
  if (isNodeOfType(candidate, "CallExpression")) {
    const callee = stripParenExpression(candidate.callee);
    return Boolean(
      isNodeOfType(callee, "MemberExpression") &&
      INTERNATIONALIZED_DATE_IMMUTABLE_METHOD_NAMES.has(getStaticPropertyName(callee) ?? "") &&
      expressionIsInternationalizedCalendarDateTime(
        callee.object,
        updaterFunction,
        setterCall,
        context,
      ),
    );
  }
  if (
    isNodeOfType(candidate, "LogicalExpression") &&
    (candidate.operator === "??" || candidate.operator === "||")
  ) {
    if (
      expressionIsInternationalizedCalendarDateTime(
        candidate.left,
        updaterFunction,
        setterCall,
        context,
      )
    ) {
      return true;
    }
    const leftCandidate = resolveDirectUnreassignedExpression(candidate.left, context.scopes);
    const leftAlwaysFallsThrough =
      candidate.operator === "??"
        ? isNullishExpression(leftCandidate)
        : isDefinitelyFalsyExpression(leftCandidate, context.scopes);
    return (
      leftAlwaysFallsThrough &&
      expressionIsInternationalizedCalendarDateTime(
        candidate.right,
        updaterFunction,
        setterCall,
        context,
      )
    );
  }
  if (isNodeOfType(candidate, "Identifier")) {
    const updaterParameterSymbol = getUpdaterParameterSymbol(updaterFunction, context);
    const candidateSymbol = context.scopes.symbolFor(candidate);
    if (updaterParameterSymbol && candidateSymbol?.id === updaterParameterSymbol.id) {
      const initialValues = getStateInitialValues(setterCall, context);
      return Boolean(
        initialValues &&
        initialValues.length > 0 &&
        initialValues.every((initialValue) =>
          expressionIsInternationalizedCalendarDateTime(
            initialValue,
            updaterFunction,
            setterCall,
            context,
          ),
        ),
      );
    }
  }
  if (!isNodeOfType(candidate, "MemberExpression")) return false;
  const initialValues = getStateMemberInitialValues(
    candidate,
    updaterFunction,
    setterCall,
    context,
  );
  return Boolean(
    initialValues &&
    initialValues.length > 0 &&
    initialValues.every((initialValue) =>
      expressionIsInternationalizedCalendarDateTime(
        initialValue,
        updaterFunction,
        setterCall,
        context,
      ),
    ),
  );
};

const expressionIsDayjsValue = (
  expression: EsTreeNode,
  updaterFunction: EsTreeNode,
  setterCall: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): boolean => {
  const candidate = resolveDirectUnreassignedExpression(expression, context.scopes);
  if (isNodeOfType(candidate, "CallExpression")) {
    const callee = stripParenExpression(candidate.callee);
    if (importedReferenceIsDayjsFactory(callee, context)) return true;
    return Boolean(
      isNodeOfType(callee, "MemberExpression") &&
      DAYJS_IMMUTABLE_METHOD_NAMES.has(getStaticPropertyName(callee) ?? "") &&
      expressionIsDayjsValue(callee.object, updaterFunction, setterCall, context),
    );
  }
  if (
    isNodeOfType(candidate, "LogicalExpression") &&
    (candidate.operator === "??" || candidate.operator === "||")
  ) {
    if (expressionIsDayjsValue(candidate.left, updaterFunction, setterCall, context)) {
      return true;
    }
    const leftCandidate = resolveDirectUnreassignedExpression(candidate.left, context.scopes);
    const leftAlwaysFallsThrough =
      candidate.operator === "??"
        ? isNullishExpression(leftCandidate)
        : isDefinitelyFalsyExpression(leftCandidate, context.scopes);
    return (
      leftAlwaysFallsThrough &&
      expressionIsDayjsValue(candidate.right, updaterFunction, setterCall, context)
    );
  }
  if (isNodeOfType(candidate, "Identifier")) {
    const updaterParameterSymbol = getUpdaterParameterSymbol(updaterFunction, context);
    const candidateSymbol = context.scopes.symbolFor(candidate);
    if (updaterParameterSymbol && candidateSymbol?.id === updaterParameterSymbol.id) {
      const initialValues = getStateInitialValues(setterCall, context);
      return Boolean(
        initialValues &&
        initialValues.length > 0 &&
        initialValues.every((initialValue) =>
          expressionIsDayjsValue(initialValue, updaterFunction, setterCall, context),
        ),
      );
    }
  }
  if (!isNodeOfType(candidate, "MemberExpression")) return false;
  const initialValues = getStateMemberInitialValues(
    candidate,
    updaterFunction,
    setterCall,
    context,
  );
  return Boolean(
    initialValues &&
    initialValues.length > 0 &&
    initialValues.every((initialValue) =>
      expressionIsDayjsValue(initialValue, updaterFunction, setterCall, context),
    ),
  );
};

const callUsesProvenImmutableLibraryValueMethod = (
  call: EsTreeNodeOfType<"CallExpression">,
  updaterFunction: EsTreeNode,
  setterCall: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): boolean => {
  const callee = stripParenExpression(call.callee);
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  const methodName = getStaticPropertyName(callee);
  if (
    methodName &&
    INTERNATIONALIZED_DATE_IMMUTABLE_METHOD_NAMES.has(methodName) &&
    expressionIsInternationalizedCalendarDateTime(
      callee.object,
      updaterFunction,
      setterCall,
      context,
    )
  ) {
    return true;
  }
  if (!methodName || !DAYJS_IMMUTABLE_METHOD_NAMES.has(methodName)) return false;
  return expressionIsDayjsValue(callee.object, updaterFunction, setterCall, context);
};

const expressionIsDirectFreshContainer = (
  expression: EsTreeNode,
  context: RuleContext,
): boolean => {
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "ObjectExpression") || isNodeOfType(candidate, "ArrayExpression")) {
    return true;
  }
  if (isCpuTypedArray(candidate, context.scopes)) return true;
  if (!isNodeOfType(candidate, "NewExpression")) return false;
  const constructor = stripParenExpression(candidate.callee);
  return Boolean(
    isNodeOfType(constructor, "Identifier") &&
    FRESH_CONTAINER_CONSTRUCTOR_NAMES.has(constructor.name) &&
    context.scopes.isGlobalReference(constructor),
  );
};

const identifierIsDeclaredInCurrentExecution = (
  identifier: EsTreeNodeOfType<"Identifier">,
  context: RuleContext,
): boolean => {
  const symbol = context.scopes.symbolFor(identifier);
  return Boolean(
    symbol &&
    findDeferredExecutionBoundary(symbol.bindingIdentifier) ===
      findDeferredExecutionBoundary(identifier),
  );
};

const identifierIsAssignedOnlyFreshContainers = (
  identifier: EsTreeNodeOfType<"Identifier">,
  context: RuleContext,
  includeCurrentAssignment = false,
): boolean => {
  const symbol = context.scopes.symbolFor(identifier);
  if (!symbol || !identifierIsDeclaredInCurrentExecution(identifier, context)) return false;
  const initializer = symbol.initializer ? stripParenExpression(symbol.initializer) : null;
  const isEmptyInitializer =
    !initializer ||
    (isNodeOfType(initializer, "Literal") && initializer.value === null) ||
    (isNodeOfType(initializer, "Identifier") &&
      initializer.name === "undefined" &&
      context.scopes.isGlobalReference(initializer));
  if (!isEmptyInitializer) {
    return false;
  }
  let hasPriorFreshAssignment = false;
  for (const reference of symbol.references) {
    if (reference.flag === "read") continue;
    const referenceRoot = findTransparentExpressionRoot(reference.identifier);
    const assignment = referenceRoot.parent;
    if (
      !assignment ||
      !isNodeOfType(assignment, "AssignmentExpression") ||
      (assignment.operator !== "=" &&
        assignment.operator !== "??=" &&
        assignment.operator !== "||=") ||
      assignment.left !== referenceRoot ||
      !expressionCreatesFreshContainer(assignment.right, context)
    ) {
      return false;
    }
    if (
      (includeCurrentAssignment
        ? assignment.range[0] <= identifier.range[0]
        : assignment.range[0] < identifier.range[0]) &&
      findDeferredExecutionBoundary(assignment) === findDeferredExecutionBoundary(identifier)
    ) {
      hasPriorFreshAssignment = true;
    }
  }
  return hasPriorFreshAssignment;
};

const expressionIsFreshContainer = (expression: EsTreeNode, context: RuleContext): boolean => {
  const candidate = stripParenExpression(expression);
  if (expressionIsDirectFreshContainer(candidate, context)) return true;
  if (!isNodeOfType(candidate, "AssignmentExpression")) return false;
  const left = stripParenExpression(candidate.left);
  if (!isNodeOfType(left, "Identifier")) return false;
  if (candidate.operator === "=") {
    return Boolean(
      identifierIsDeclaredInCurrentExecution(left, context) &&
      expressionCreatesFreshContainer(candidate.right, context),
    );
  }
  return Boolean(
    (candidate.operator === "??=" || candidate.operator === "||=") &&
    identifierIsAssignedOnlyFreshContainers(left, context, true),
  );
};

const functionReturnsOnlyFreshContainers = (
  functionNode: EsTreeNode,
  context: RuleContext,
): boolean => {
  const returnValues = collectFunctionReturnValues(functionNode);
  return Boolean(
    returnValues?.every((returnValue) => expressionIsFreshContainer(returnValue, context)),
  );
};

const callReturnsOnlyFreshContainers = (
  call: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): boolean => {
  const calledFunction = resolveCalledLocalFunction(call, context);
  return Boolean(calledFunction && functionReturnsOnlyFreshContainers(calledFunction, context));
};

const expressionCreatesFreshContainer = (expression: EsTreeNode, context: RuleContext): boolean => {
  const candidate = stripParenExpression(expression);
  return Boolean(
    expressionIsDirectFreshContainer(candidate, context) ||
    (isNodeOfType(candidate, "CallExpression") &&
      callReturnsOnlyFreshContainers(candidate, context)),
  );
};

const getPropertyValueAfterMutation = (
  currentValue: EsTreeNode | null,
  mutationNode: EsTreeNode,
  propertyName: string,
  context: RuleContext,
): EsTreeNode | null => {
  const mutationInspector = getSymbolMutationInspector(context.scopes);
  const target = mutationInspector.getOutermostTarget(mutationNode);
  const parent = target.parent;
  if (!parent) return null;
  if (
    (isNodeOfType(parent, "AssignmentExpression") && parent.left === target) ||
    (isNodeOfType(parent, "UpdateExpression") && parent.argument === target) ||
    (isNodeOfType(parent, "UnaryExpression") &&
      parent.operator === "delete" &&
      parent.argument === target)
  ) {
    if (!isNodeOfType(target, "MemberExpression")) return null;
    if (stripParenExpression(target.object) !== findTransparentExpressionRoot(mutationNode)) {
      return currentValue;
    }
    const mutationPropertyName = getStaticPropertyName(target);
    if (mutationPropertyName !== null && mutationPropertyName !== propertyName) {
      return currentValue;
    }
    if (
      mutationPropertyName === null &&
      isNodeOfType(parent, "AssignmentExpression") &&
      parent.operator === "=" &&
      currentValue &&
      expressionCreatesFreshContainer(currentValue, context) &&
      expressionCreatesFreshContainer(parent.right, context)
    ) {
      return parent.right;
    }
    if (
      mutationPropertyName === null ||
      !isNodeOfType(parent, "AssignmentExpression") ||
      parent.operator !== "="
    ) {
      return null;
    }
    return parent.right;
  }
  if (
    !isNodeOfType(parent, "CallExpression") ||
    parent.arguments[0] !== target ||
    target !== findTransparentExpressionRoot(mutationNode)
  ) {
    return null;
  }
  if (
    mutationInspector.isGlobalNamespaceMethod(
      parent.callee,
      "Object",
      OBJECT_PROPERTY_MUTATION_METHOD_NAMES,
    )
  ) {
    const callee = stripParenExpression(parent.callee);
    if (!isNodeOfType(callee, "MemberExpression")) return null;
    const methodName = getStaticPropertyName(callee);
    if (methodName === "assign") {
      let assignedValue = currentValue;
      for (const source of parent.arguments.slice(1)) {
        if (isNodeOfType(source, "SpreadElement")) {
          assignedValue = null;
          continue;
        }
        const sourceValue = getStaticObjectPropertyValue(source, propertyName);
        if (sourceValue !== undefined) assignedValue = sourceValue;
      }
      return assignedValue;
    }
    if (methodName === "defineProperties") {
      const descriptors = parent.arguments[1];
      if (!descriptors || isNodeOfType(descriptors, "SpreadElement")) return null;
      const descriptor = getStaticObjectPropertyValue(descriptors, propertyName);
      if (descriptor === null) return null;
      if (descriptor === undefined) return currentValue;
      const descriptorValue = getPropertyDescriptorValue(descriptor);
      return descriptorValue === undefined ? currentValue : descriptorValue;
    }
  }
  const isObjectDefineProperty = mutationInspector.isGlobalNamespaceMethod(
    parent.callee,
    "Object",
    OBJECT_DEFINE_PROPERTY_METHOD_NAMES,
  );
  const isReflectPropertyMutation = mutationInspector.isGlobalNamespaceMethod(
    parent.callee,
    "Reflect",
    REFLECT_PROPERTY_MUTATION_METHOD_NAMES,
  );
  if (!isObjectDefineProperty && !isReflectPropertyMutation) return null;
  const mutationProperty = parent.arguments[1];
  if (
    !mutationProperty ||
    !isNodeOfType(mutationProperty, "Literal") ||
    typeof mutationProperty.value !== "string"
  ) {
    return null;
  }
  if (mutationProperty.value !== propertyName) return currentValue;
  const mutationValue = parent.arguments[2];
  if (!mutationValue || isNodeOfType(mutationValue, "SpreadElement")) return null;
  const propertyMutationCallee = stripParenExpression(parent.callee);
  if (!isNodeOfType(propertyMutationCallee, "MemberExpression")) return null;
  if (
    isObjectDefineProperty ||
    getStaticPropertyName(propertyMutationCallee) === "defineProperty"
  ) {
    const descriptorValue = getPropertyDescriptorValue(mutationValue);
    return descriptorValue === undefined ? currentValue : descriptorValue;
  }
  return mutationValue;
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
  const objectSymbol = resolveConstIdentifierAlias(object, context.scopes);
  if (!objectSymbol || visitedSymbolIds.has(objectSymbol.id)) return false;
  const isDeclaredInsideUpdater = [...executedFunctions].some((functionNode) =>
    isAstDescendant(objectSymbol.bindingIdentifier, functionNode),
  );
  if (!isDeclaredInsideUpdater) return false;
  const initializer = objectSymbol.initializer
    ? stripParenExpression(objectSymbol.initializer)
    : null;
  if (!isNodeOfType(initializer, "ObjectExpression")) return false;
  let effectiveValue = getStaticObjectPropertyValue(initializer, propertyName) ?? null;
  const mutationInspector = getSymbolMutationInspector(context.scopes);
  if (mutationInspector.isMutationOrderAmbiguous(objectSymbol, receiver, propertyName)) {
    return false;
  }
  for (const mutation of mutationInspector.getEventsBefore(objectSymbol, receiver)) {
    const nextValue = getPropertyValueAfterMutation(
      effectiveValue,
      mutation.node,
      propertyName,
      context,
    );
    if (
      mutation.isConditional &&
      (!effectiveValue ||
        !nextValue ||
        !expressionCreatesFreshContainer(effectiveValue, context) ||
        !expressionCreatesFreshContainer(nextValue, context))
    ) {
      effectiveValue = null;
      continue;
    }
    effectiveValue = nextValue;
  }
  if (!effectiveValue) return false;
  const value = stripParenExpression(effectiveValue);
  if (expressionCreatesFreshContainer(value, context)) return true;
  if (isNodeOfType(value, "CallExpression")) {
    const callee = stripParenExpression(value.callee);
    const receiverRoot = findTransparentExpressionRoot(receiver);
    const containingMember = receiverRoot.parent;
    const mutationMethodName =
      isNodeOfType(containingMember, "MemberExpression") && containingMember.object === receiverRoot
        ? getStaticPropertyName(containingMember)
        : null;
    return Boolean(
      !MUTATING_COLLECTION_METHODS.has(mutationMethodName ?? "") &&
      isNodeOfType(callee, "Identifier") &&
      /^(?:create|make)Local[A-Z_]/.test(callee.name),
    );
  }
  return Boolean(
    isNodeOfType(value, "Identifier") &&
    receiverIsUpdaterLocal(
      value,
      updaterFunction,
      executedFunctions,
      context,
      new Set([...visitedSymbolIds, objectSymbol.id]),
    ),
  );
};

const receiverIsUpdaterLocal = (
  receiver: EsTreeNode,
  updaterFunction: EsTreeNode,
  executedFunctions: ReadonlySet<EsTreeNode>,
  context: RuleContext,
  visitedSymbolIds: Set<number> = new Set(),
): boolean => {
  const unwrappedReceiver = stripParenExpression(receiver);
  if (expressionIsFreshContainer(unwrappedReceiver, context)) return true;
  if (isNodeOfType(unwrappedReceiver, "CallExpression")) {
    return callReturnsOnlyFreshContainers(unwrappedReceiver, context);
  }
  if (isNodeOfType(unwrappedReceiver, "AssignmentExpression")) {
    const assignmentTarget = stripParenExpression(unwrappedReceiver.left);
    return Boolean(
      unwrappedReceiver.operator === "=" &&
      isNodeOfType(assignmentTarget, "MemberExpression") &&
      expressionCreatesFreshContainer(unwrappedReceiver.right, context) &&
      receiverIsUpdaterLocal(
        assignmentTarget.object,
        updaterFunction,
        executedFunctions,
        context,
        visitedSymbolIds,
      ),
    );
  }
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
  if (identifierIsAssignedOnlyFreshContainers(baseIdentifier, context)) return true;
  if (!initializer) return false;
  if (expressionIsFreshContainer(initializer, context)) return true;
  if (isNodeOfType(initializer, "CallExpression")) {
    return callReturnsOnlyFreshContainers(initializer, context);
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
    if (parent && isNodeOfType(parent, "ConditionalExpression")) {
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
  return CALLBACK_PROP_NAME_PATTERN.test(
    getDestructuredBindingPropertyName(symbol.bindingIdentifier) ?? "",
  );
};

const callStartsPromiseChain = (call: EsTreeNodeOfType<"CallExpression">): boolean => {
  const callRoot = findTransparentExpressionRoot(call);
  const parent = callRoot.parent;
  return Boolean(
    parent &&
    isNodeOfType(parent, "MemberExpression") &&
    parent.object === callRoot &&
    PROMISE_SETTLE_METHODS.has(getStaticPropertyName(parent) ?? ""),
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
  if (identifierIsCallbackParameter(unwrappedValue, context)) return true;
  if (
    isNodeOfType(unwrappedValue, "MemberExpression") &&
    CALLBACK_PROP_NAME_PATTERN.test(getStaticPropertyName(unwrappedValue) ?? "")
  ) {
    return true;
  }
  return expressionLooksLikeExternalCallback(unwrappedValue);
};

const memberReceiverIsLocalObjectLiteral = (
  callee: EsTreeNodeOfType<"MemberExpression">,
  updaterFunction: EsTreeNode,
  executedFunctions: ReadonlySet<EsTreeNode>,
  invocationReferenceNode: EsTreeNodeOfType<"CallExpression">,
  canUseStateOwner: boolean,
  context: RuleContext,
): boolean => {
  const receiver = stripParenExpression(callee.object);
  if (!isNodeOfType(receiver, "Identifier")) return false;
  const receiverSymbol = resolveConstIdentifierAlias(receiver, context.scopes);
  const receiverOwner = receiverSymbol
    ? findEnclosingFunction(receiverSymbol.bindingIdentifier)
    : null;
  const invocationCallee = canUseStateOwner
    ? stripParenExpression(invocationReferenceNode.callee)
    : null;
  const statePair =
    invocationCallee && isNodeOfType(invocationCallee, "Identifier")
      ? resolveReactUseStatePair(invocationCallee, context.scopes)
      : null;
  const stateOwner = statePair
    ? findEnclosingFunction(statePair.setterSymbol.bindingIdentifier)
    : null;
  const isShadowedGlobalObject =
    GLOBAL_OBJECT_RECEIVER_NAMES.has(receiver.name) && !context.scopes.isGlobalReference(receiver);
  return Boolean(
    receiverSymbol?.initializer &&
    isNodeOfType(stripParenExpression(receiverSymbol.initializer), "ObjectExpression") &&
    (isShadowedGlobalObject ||
      (receiverOwner !== null && receiverOwner === findEnclosingFunction(updaterFunction)) ||
      (receiverOwner !== null && receiverOwner === stateOwner) ||
      receiverIsUpdaterLocal(receiver, updaterFunction, executedFunctions, context)),
  );
};

const receiverIsPlatformAppendBuilder = (expression: EsTreeNode, context: RuleContext): boolean => {
  let receiver = stripParenExpression(expression);
  if (isNodeOfType(receiver, "Identifier")) {
    const receiverSymbol = resolveConstIdentifierAlias(receiver, context.scopes);
    if (!receiverSymbol?.initializer) return false;
    receiver = stripParenExpression(receiverSymbol.initializer);
  }
  if (!isNodeOfType(receiver, "NewExpression")) return false;
  const constructor = stripParenExpression(receiver.callee);
  return Boolean(
    isNodeOfType(constructor, "Identifier") &&
    PLATFORM_APPEND_CONSTRUCTOR_NAMES.has(constructor.name) &&
    context.scopes.isGlobalReference(constructor),
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
  invocationReferenceNode: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): boolean => {
  const callName = getCallName(call);
  if (!callName) return false;
  const callee = stripParenExpression(call.callee);
  if (
    callUsesProvenImmutableLibraryValueMethod(
      call,
      updaterFunction,
      invocationReferenceNode,
      context,
    )
  ) {
    return false;
  }
  const memberCalleeUsesExternalCallback =
    isNodeOfType(callee, "MemberExpression") &&
    freshObjectMethodIsExternalCallback(call, invocationReferenceNode, context);
  const memberCalleeIsExternalCallback =
    isNodeOfType(callee, "MemberExpression") &&
    CALLBACK_PROP_NAME_PATTERN.test(getStaticPropertyName(callee) ?? "") &&
    (memberCalleeUsesExternalCallback ||
      receiverRootIsUpdaterParameter(callee.object, updaterFunction, context) ||
      (!memberReceiverIsLocalObjectLiteral(
        callee,
        updaterFunction,
        executedFunctions,
        invocationReferenceNode,
        false,
        context,
      ) &&
        !receiverIsUpdaterLocal(callee.object, updaterFunction, executedFunctions, context)));
  const isDiscardedExternalCallbackCall =
    isResultDiscardedCall(call) &&
    (identifierIsCallbackParameter(callee, context) || memberCalleeIsExternalCallback);
  const isAsyncUpdateCall =
    ASYNC_UPDATE_CALL_NAME_PATTERN.test(callName) && callStartsPromiseChain(call);
  const isPlatformAppendMutation =
    callName === "append" &&
    isNodeOfType(callee, "MemberExpression") &&
    receiverIsPlatformAppendBuilder(callee.object, context);
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
    !isAsyncUpdateCall &&
    !isDiscardedExternalCallbackCall &&
    !(GLOBAL_SIDE_EFFECT_CALL_NAMES.has(callName) && context.scopes.isGlobalReference(callee)) &&
    !(GLOBAL_SCHEDULER_CALL_NAMES.has(callName) && context.scopes.isGlobalReference(callee))
  ) {
    return false;
  }
  if (isDiscardedExternalCallbackCall) return true;
  if (memberCalleeUsesExternalCallback) return true;
  if (
    isNodeOfType(callee, "MemberExpression") &&
    !SIDE_EFFECT_CALL_NAME_PATTERN.test(callName) &&
    !SIDE_EFFECT_METHOD_NAMES.has(callName) &&
    !MUTATING_COLLECTION_METHODS.has(callName) &&
    !isPlatformAppendMutation &&
    !isAsyncUpdateCall &&
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
    memberReceiverIsLocalObjectLiteral(
      callee,
      updaterFunction,
      executedFunctions,
      invocationReferenceNode,
      false,
      context,
    )
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
            const resolvedCallee = stripParenExpression(child.callee);
            if (
              resolvedFunction &&
              executedFunctions.has(resolvedFunction) &&
              (!isNodeOfType(resolvedCallee, "MemberExpression") ||
                memberReceiverIsLocalObjectLiteral(
                  resolvedCallee,
                  updaterFunction,
                  executedFunctions,
                  node,
                  true,
                  context,
                ))
            ) {
              return;
            }
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
