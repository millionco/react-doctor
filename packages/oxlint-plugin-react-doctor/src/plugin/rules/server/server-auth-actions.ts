import {
  AUTH_CHECK_LOOKAHEAD_STATEMENTS,
  AUTH_FUNCTION_NAMES,
  AUTH_OBJECT_PATTERN,
  GENERIC_AUTH_METHOD_NAMES,
  SECRET_VARIABLE_PATTERN,
} from "../../constants/security.js";
import {
  MUTATION_METHOD_NAMES,
  RESPONSE_FACTORY_METHODS,
  SAFE_MUTABLE_CONSTRUCTOR_NAMES,
} from "../../constants/library.js";
import { defineRule } from "../../utils/define-rule.js";
import { executesDuringRender } from "../../utils/executes-during-render.js";
import { collectPossibleAssignedExpressions } from "../../utils/collect-possible-assigned-expressions.js";
import { findExportedValue } from "../../utils/find-exported-value.js";
import {
  getImportBindingForName,
  getImportedNameFromModule,
} from "../../utils/find-import-source-for-name.js";
import { findSideEffect, isMutatingFetchCall } from "../../utils/find-side-effect.js";
import { getAssignedExpressionForWrite } from "../../utils/get-assigned-expression-for-write.js";
import { getRootIdentifier } from "../../utils/get-root-identifier.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { getSymbolTypeAnnotation } from "../../utils/get-symbol-type-annotation.js";
import { hasEnclosingTypeParameterNamed } from "../../utils/has-enclosing-type-parameter-named.js";
import { hasStaticPropertyWriteBefore } from "../../utils/has-static-property-write-before.js";
import { hasVisibleBindingNamed } from "../../utils/has-visible-binding-named.js";
import { getReactDoctorStringArraySetting } from "../../utils/get-react-doctor-setting.js";
import { hasDirective } from "../../utils/has-directive.js";
import { hasUseServerDirective } from "../../utils/has-use-server-directive.js";
import { isAuthGuardName } from "../../utils/is-auth-guard-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isImmediatelyInvokedFunction } from "../../utils/is-immediately-invoked-function.js";
import { isNonPrivilegedServerAction } from "../../utils/is-non-privileged-server-action.js";
import { isNodeConditionallyExecuted } from "../../utils/is-node-conditionally-executed.js";
import { isNodeReachableWithinFunction } from "../../utils/is-node-reachable-within-function.js";
import { resolveExactLocalFunction } from "../../utils/resolve-exact-local-function.js";
import {
  isTestlikeFilename,
  isTestlikeFilenameIgnoringPathSegments,
} from "../../utils/is-testlike-filename.js";
import { tokenizeIdentifierWords } from "../../utils/tokenize-identifier-words.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { RuleVisitors } from "../../utils/rule-visitors.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { SymbolDescriptor } from "../../semantic/scope-analysis.js";

type AsyncFunctionLikeNode =
  | EsTreeNodeOfType<"FunctionDeclaration">
  | EsTreeNodeOfType<"FunctionExpression">
  | EsTreeNodeOfType<"ArrowFunctionExpression">;

const MUTATING_SQL_STATEMENT_PATTERN =
  /^\s*(?:alter|create|delete|drop|grant|insert|merge|replace|revoke|truncate|update)\b/i;
const SQL_LEADING_COMMENT_PATTERN = /^(?:\s|--[^\r\n]*(?:\r?\n|$)|\/\*[\s\S]*?\*\/)+/;
const IMPORTED_MUTATION_PREFIX_TOKENS: ReadonlySet<string> = new Set([
  "apply",
  "execute",
  "perform",
  "run",
]);
const IMPORTED_MUTATION_OPERATION_TOKENS: ReadonlySet<string> = new Set([
  "append",
  "create",
  "delete",
  "destroy",
  "insert",
  "mutate",
  "persist",
  "remove",
  "set",
  "update",
  "upsert",
  "write",
]);
const PUBLIC_SECRET_NAME_TOKENS: ReadonlySet<string> = new Set(["anon", "public", "publishable"]);
const SECRET_METADATA_SUFFIX_TOKENS: ReadonlySet<string> = new Set([
  "endpoint",
  "header",
  "kind",
  "name",
  "type",
  "uri",
  "url",
]);

const isAsyncFunctionLikeNode = (
  node: EsTreeNode | null | undefined,
): node is AsyncFunctionLikeNode => {
  if (!node) return false;
  if (
    !isNodeOfType(node, "FunctionDeclaration") &&
    !isNodeOfType(node, "FunctionExpression") &&
    !isNodeOfType(node, "ArrowFunctionExpression")
  ) {
    return false;
  }
  return Boolean(node.async);
};

const unwrapTypeWrappedCallee = (node: EsTreeNode | null | undefined): EsTreeNode | null => {
  let currentNode: EsTreeNode | null | undefined = node;
  while (currentNode) {
    if (
      isNodeOfType(currentNode, "TSAsExpression") ||
      isNodeOfType(currentNode, "TSNonNullExpression") ||
      isNodeOfType(currentNode, "TSTypeAssertion") ||
      isNodeOfType(currentNode, "TSSatisfiesExpression") ||
      isNodeOfType(currentNode, "TSInstantiationExpression")
    ) {
      currentNode = currentNode.expression;
      continue;
    }
    if (isNodeOfType(currentNode, "ChainExpression")) {
      currentNode = currentNode.expression;
      continue;
    }
    return currentNode;
  }
  return null;
};

const buildDottedReceiverSource = (receiverNode: EsTreeNode | null | undefined): string => {
  const unwrapped = unwrapTypeWrappedCallee(receiverNode);
  if (!unwrapped) return "";
  if (isNodeOfType(unwrapped, "Identifier")) return unwrapped.name;
  if (isNodeOfType(unwrapped, "ThisExpression")) return "this";
  if (isNodeOfType(unwrapped, "MemberExpression")) {
    const objectSource = buildDottedReceiverSource(unwrapped.object);
    const propertyName = isNodeOfType(unwrapped.property, "Identifier")
      ? unwrapped.property.name
      : "";
    if (!propertyName) return objectSource;
    return objectSource ? `${objectSource}.${propertyName}` : propertyName;
  }
  return "";
};

const isMemberCallAuthRelated = (
  receiverNode: EsTreeNode | null | undefined,
  methodName: string,
  genericMethodNames: ReadonlySet<string>,
): boolean => {
  if (!genericMethodNames.has(methodName)) return true;
  const receiverSource = buildDottedReceiverSource(receiverNode);
  return AUTH_OBJECT_PATTERN.test(receiverSource);
};

const receiverOriginatesFromParameter = (
  receiverNode: EsTreeNode,
  context: RuleContext,
  visitedSymbolIds: Set<number> = new Set(),
): boolean => {
  const node = unwrapTypeWrappedCallee(receiverNode);
  if (!node) return false;
  if (isNodeOfType(node, "MemberExpression")) {
    return receiverOriginatesFromParameter(node.object, context, visitedSymbolIds);
  }
  if (!isNodeOfType(node, "Identifier")) return false;
  const symbol = context.scopes.symbolFor(node);
  if (!symbol || visitedSymbolIds.has(symbol.id)) return false;
  if (symbol.kind === "parameter" || symbol.kind === "catch-clause-parameter") return true;
  visitedSymbolIds.add(symbol.id);
  return collectPossibleAssignedExpressions(symbol, node, context.cfg).some((assignedExpression) =>
    receiverOriginatesFromParameter(assignedExpression, context, new Set(visitedSymbolIds)),
  );
};

const getAuthCallName = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
  allowedFunctionNames: ReadonlySet<string>,
  genericMethodNames: ReadonlySet<string>,
  customAuthFunctionNames: ReadonlySet<string>,
  context: RuleContext,
): string | null => {
  const calleeNode = unwrapTypeWrappedCallee(callExpression.callee);
  if (!calleeNode) return null;
  if (isNodeOfType(calleeNode, "Identifier")) {
    const calleeName = calleeNode.name;
    if (!allowedFunctionNames.has(calleeName) && !isAuthGuardName(calleeName)) return null;
    const symbol = context.scopes.symbolFor(calleeNode);
    if (symbol?.kind === "parameter" || symbol?.kind === "catch-clause-parameter") return null;
    if (
      symbol &&
      symbol.kind !== "import" &&
      !customAuthFunctionNames.has(calleeName) &&
      !resolveExactLocalFunction(calleeNode, context.scopes)
    ) {
      return null;
    }
    return calleeName;
  }
  if (
    isNodeOfType(calleeNode, "MemberExpression") &&
    isNodeOfType(calleeNode.property, "Identifier")
  ) {
    const methodName = calleeNode.property.name;
    if (receiverOriginatesFromParameter(calleeNode.object, context)) return null;
    // A conventionally auth-shaped method name (`ctx.requireAdmin()`,
    // `auth0.getSession()`) is distinctive enough to accept on any receiver;
    // only the exact-allowlist names fall back to the auth-receiver check
    // that keeps generic ones like `analytics.getUser()` out.
    if (isAuthGuardName(methodName)) return methodName;
    if (!allowedFunctionNames.has(methodName)) return null;
    if (!isMemberCallAuthRelated(calleeNode.object, methodName, genericMethodNames)) return null;
    return methodName;
  }
  return null;
};

const isPotentialPrivilegedMutationCall = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  if (isMutatingFetchCall(node)) return true;
  const callee = unwrapTypeWrappedCallee(node.callee);
  if (!callee || !isNodeOfType(callee, "MemberExpression")) return false;
  const methodName = getStaticPropertyName(callee);
  return Boolean(
    methodName &&
    (MUTATION_METHOD_NAMES.has(methodName) || BILLABLE_LANGCHAIN_METHOD_NAMES.has(methodName)),
  );
};

const isImportedMutationFunctionName = (functionName: string): boolean => {
  const nameTokens = tokenizeIdentifierWords(functionName);
  return Boolean(
    nameTokens.length >= 2 &&
    IMPORTED_MUTATION_PREFIX_TOKENS.has(nameTokens[0]) &&
    nameTokens.slice(1).some((nameToken) => IMPORTED_MUTATION_OPERATION_TOKENS.has(nameToken)),
  );
};

const getImportedMutationCallName = (node: EsTreeNode, context: RuleContext): string | null => {
  if (!isNodeOfType(node, "CallExpression")) return null;
  const callee = unwrapTypeWrappedCallee(node.callee);
  if (isNodeOfType(callee, "Identifier")) {
    if (context.scopes.symbolFor(callee)?.kind !== "import") return null;
    const importBinding = getImportBindingForName(callee, callee.name);
    if (!importBinding || importBinding.isNamespace) return null;
    const functionName =
      importBinding.exportedName === "default"
        ? callee.name
        : (importBinding.exportedName ?? callee.name);
    return isImportedMutationFunctionName(functionName) ? functionName : null;
  }
  if (!isNodeOfType(callee, "MemberExpression")) return null;
  const receiver = unwrapTypeWrappedCallee(callee.object);
  if (!isNodeOfType(receiver, "Identifier")) return null;
  if (context.scopes.symbolFor(receiver)?.kind !== "import") return null;
  const importBinding = getImportBindingForName(receiver, receiver.name);
  if (!importBinding?.isNamespace) return null;
  const functionName = getStaticPropertyName(callee);
  return functionName && isImportedMutationFunctionName(functionName) ? functionName : null;
};

const isStaticallyUnreachableExecutionNode = (node: EsTreeNode, context: RuleContext): boolean => {
  const enclosingFunction = context.cfg.enclosingFunction(node);
  return Boolean(
    enclosingFunction &&
    isNodeConditionallyExecuted(node, enclosingFunction) &&
    !isNodeReachableWithinFunction(node, context),
  );
};

const localFunctionContainsPotentialPrivilegedOperation = (
  functionNode: EsTreeNode,
  context: RuleContext,
  visitedFunctions: Set<EsTreeNode> = new Set(),
): boolean => {
  if (!isFunctionLike(functionNode) || visitedFunctions.has(functionNode)) return false;
  visitedFunctions.add(functionNode);
  let containsPotentialPrivilegedOperation = false;
  walkAst(functionNode.body, (node) => {
    if (containsPotentialPrivilegedOperation) return false;
    if (node !== functionNode.body && isFunctionLike(node)) return false;
    if (isStaticallyUnreachableExecutionNode(node, context)) return;
    if (
      isPotentialPrivilegedMutationCall(node) ||
      getImportedMutationCallName(node, context) ||
      getModuleStateMutationDescription(node, context) ||
      getMutatingSqlTaggedTemplateDescription(node, context) ||
      callExecutesPotentialPrivilegedCallback(node, context, visitedFunctions)
    ) {
      containsPotentialPrivilegedOperation = true;
      return false;
    }
    if (!isNodeOfType(node, "CallExpression")) return;
    const localFunction = resolveLocalFunction(node.callee, context);
    if (
      localFunction &&
      localFunctionContainsPotentialPrivilegedOperation(
        localFunction,
        context,
        new Set(visitedFunctions),
      )
    ) {
      containsPotentialPrivilegedOperation = true;
      return false;
    }
  });
  return containsPotentialPrivilegedOperation;
};

const callExecutesPotentialPrivilegedCallback = (
  node: EsTreeNode,
  context: RuleContext,
  visitedFunctions: Set<EsTreeNode> = new Set(),
): boolean => {
  if (!isNodeOfType(node, "CallExpression") && !isNodeOfType(node, "NewExpression")) {
    return false;
  }
  for (const [argumentIndex, argument] of (node.arguments ?? []).entries()) {
    const callback = resolveLocalFunction(argument, context);
    if (!callback) continue;
    const callee = unwrapTypeWrappedCallee(node.callee);
    const methodName =
      callee && isNodeOfType(callee, "MemberExpression") ? getStaticPropertyName(callee) : null;
    const isTypedCollectionCallback = Boolean(
      callee &&
      isNodeOfType(callee, "MemberExpression") &&
      methodName &&
      argumentIndex === 0 &&
      SYNCHRONOUS_COLLECTION_CALLBACK_METHOD_NAMES.has(methodName) &&
      isProvenSynchronousCollection(callee.object, context) &&
      !hasStaticPropertyWriteBefore(callee.object, methodName, node, context.scopes),
    );
    if (
      (isTypedCollectionCallback ||
        executesDuringRender(argument, context.scopes, {
          requireProvenSynchronousCallbackReceiver: true,
        })) &&
      localFunctionContainsPotentialPrivilegedOperation(
        callback,
        context,
        new Set(visitedFunctions),
      )
    ) {
      return true;
    }
  }
  return false;
};

const getFirstPotentialMutationStart = (
  rootNode: EsTreeNode,
  context: RuleContext,
): number | null => {
  let firstMutationStart: number | null = null;
  walkAst(rootNode, (node) => {
    if (node !== rootNode && isFunctionLike(node)) return false;
    if (isStaticallyUnreachableExecutionNode(node, context)) return;
    const localFunction = isNodeOfType(node, "CallExpression")
      ? resolveLocalFunction(node.callee, context)
      : null;
    if (
      !isPotentialPrivilegedMutationCall(node) &&
      !getImportedMutationCallName(node, context) &&
      !getModuleStateMutationDescription(node, context) &&
      !getMutatingSqlTaggedTemplateDescription(node, context) &&
      !callExecutesPotentialPrivilegedCallback(node, context) &&
      (!localFunction || !localFunctionContainsPotentialPrivilegedOperation(localFunction, context))
    ) {
      return;
    }
    if (firstMutationStart === null || node.range[0] < firstMutationStart) {
      firstMutationStart = node.range[0];
    }
  });
  return firstMutationStart;
};

const containsAuthCheck = (
  rootNodes: EsTreeNode[],
  allowedFunctionNames: ReadonlySet<string>,
  genericMethodNames: ReadonlySet<string>,
  customAuthFunctionNames: ReadonlySet<string>,
  context: RuleContext,
): boolean => {
  let foundAuthCall = false;
  for (const rootNode of rootNodes) {
    walkAst(rootNode, (child: EsTreeNode) => {
      if (foundAuthCall) return;
      // Prune at any function-like node. A call to `auth()` inside a
      // helper that the action never invokes does not protect the
      // action, so we restrict the search to expressions evaluated
      // directly by the action's top-level statements. This also
      // covers a hoisted-helper top-level statement (a
      // FunctionDeclaration as a root) — we don't want its inner
      // `auth()` to count either.
      if (isFunctionLike(child)) return false;
      if (!isNodeOfType(child, "CallExpression")) return;
      if (!context.cfg.isUnconditionalFromEntry(child)) return;
      if (isNodeConditionallyExecuted(child, rootNode)) return;
      const firstMutationStart = getFirstPotentialMutationStart(rootNode, context);
      if (firstMutationStart !== null && firstMutationStart < child.range[0]) return;
      if (
        getAuthCallName(
          child,
          allowedFunctionNames,
          genericMethodNames,
          customAuthFunctionNames,
          context,
        )
      ) {
        foundAuthCall = true;
      }
    });
  }
  return foundAuthCall;
};

interface ServerActionCandidate {
  functionNode: AsyncFunctionLikeNode;
  displayName: string;
  reportNode: EsTreeNode;
}

interface ExecutedFunctionGraph {
  bodies: EsTreeNode[];
  argumentValuesByParameterSymbolId: Map<number, EsTreeNode[]>;
  unknownParameterSymbolIds: Set<number>;
  unknownSpreadParameterSymbolIds: Set<number>;
  invocationStartsByFunction: Map<EsTreeNode, number[]>;
}

const COMPONENT_NAME_PATTERN = /^[A-Z]/;
const TEST_APP_SOURCE_PATH_PATTERN = /(?:^|[/\\])test[/\\](?:app|src)[/\\]/;
const APP_ROUTER_SOURCE_PATH_PATTERN = /(?:^|[/\\])app[/\\]/;
const APP_ROUTER_PRODUCTION_PATH_SEGMENTS: ReadonlySet<string> = new Set(["/tools/"]);
const BILLABLE_LANGCHAIN_METHOD_NAMES: ReadonlySet<string> = new Set([
  "batch",
  "generate",
  "invoke",
  "stream",
  "streamEvents",
]);
const LANGCHAIN_CHAINING_METHOD_NAMES: ReadonlySet<string> = new Set([
  "bind",
  "pipe",
  "withConfig",
  "withStructuredOutput",
]);
const SYNCHRONOUS_COLLECTION_CALLBACK_METHOD_NAMES: ReadonlySet<string> = new Set([
  "every",
  "filter",
  "find",
  "findIndex",
  "flatMap",
  "forEach",
  "map",
  "reduce",
  "reduceRight",
  "some",
  "sort",
]);
const SAFE_REQUEST_LOCAL_TYPE_NAMES: ReadonlySet<string> = new Set([
  "FormData",
  "Headers",
  "Map",
  "Set",
  "URLSearchParams",
]);
const SYNCHRONOUS_COLLECTION_TYPE_NAMES: ReadonlySet<string> = new Set([
  "Array",
  "ReadonlyArray",
  "Map",
  "ReadonlyMap",
  "Set",
  "ReadonlySet",
]);
const CRYPTO_BUILDER_FACTORY_NAMES: ReadonlySet<string> = new Set([
  "createHash",
  "createHmac",
  "createSign",
  "createVerify",
  "createCipheriv",
  "createDecipheriv",
]);

const getTypeReferenceName = (typeNode: EsTreeNode | null): string | null =>
  typeNode &&
  isNodeOfType(typeNode, "TSTypeReference") &&
  isNodeOfType(typeNode.typeName, "Identifier")
    ? typeNode.typeName.name
    : null;

const isUnshadowedIntrinsicTypeReference = (
  typeNode: EsTreeNode,
  typeNames: ReadonlySet<string>,
  context: RuleContext,
): boolean => {
  if (isNodeOfType(typeNode, "TSUnionType")) {
    const nonNullishTypes = typeNode.types.filter(
      (memberType) =>
        !isNodeOfType(memberType, "TSNullKeyword") &&
        !isNodeOfType(memberType, "TSUndefinedKeyword"),
    );
    return (
      nonNullishTypes.length > 0 &&
      nonNullishTypes.every((memberType) =>
        isUnshadowedIntrinsicTypeReference(memberType, typeNames, context),
      )
    );
  }
  const typeName = getTypeReferenceName(typeNode);
  return Boolean(
    typeName &&
    typeNames.has(typeName) &&
    !hasVisibleBindingNamed(typeNode, typeName, context.scopes) &&
    !hasEnclosingTypeParameterNamed(typeNode, typeName),
  );
};

const isTypedSynchronousCollectionSymbol = (
  symbol: SymbolDescriptor,
  context: RuleContext,
): boolean => {
  const typeNode = getSymbolTypeAnnotation(symbol);
  if (!typeNode) return false;
  if (isNodeOfType(typeNode, "TSArrayType") || isNodeOfType(typeNode, "TSTupleType")) return true;
  return isUnshadowedIntrinsicTypeReference(typeNode, SYNCHRONOUS_COLLECTION_TYPE_NAMES, context);
};

const isProvenSynchronousCollection = (
  expression: EsTreeNode,
  context: RuleContext,
  visitedSymbolIds: Set<number> = new Set(),
): boolean => {
  const node = unwrapTypeWrappedCallee(expression);
  if (!node) return false;
  if (isNodeOfType(node, "ArrayExpression")) return true;
  if (isNodeOfType(node, "NewExpression")) {
    return (
      isNodeOfType(node.callee, "Identifier") &&
      (node.callee.name === "Array" || node.callee.name === "Map" || node.callee.name === "Set") &&
      context.scopes.isGlobalReference(node.callee)
    );
  }
  if (!isNodeOfType(node, "Identifier")) return false;
  const symbol = context.scopes.symbolFor(node);
  if (!symbol || visitedSymbolIds.has(symbol.id)) return false;
  if (isTypedSynchronousCollectionSymbol(symbol, context)) return true;
  if (symbol.kind !== "const" || !symbol.initializer) return false;
  visitedSymbolIds.add(symbol.id);
  return isProvenSynchronousCollection(symbol.initializer, context, visitedSymbolIds);
};

const resolveLocalFunction = (expression: EsTreeNode, context: RuleContext): EsTreeNode | null => {
  const node = unwrapTypeWrappedCallee(expression);
  if (node && isFunctionLike(node)) return node;
  return node ? resolveExactLocalFunction(node, context.scopes) : null;
};

const collectExecutedFunctionBodies = (
  functionNode: AsyncFunctionLikeNode,
  context: RuleContext,
): ExecutedFunctionGraph => {
  const bodies: EsTreeNode[] = [];
  const argumentValuesByParameterSymbolId = new Map<number, EsTreeNode[]>();
  const unknownParameterSymbolIds = new Set<number>();
  const unknownSpreadParameterSymbolIds = new Set<number>();
  const invocationStartsByFunction = new Map<EsTreeNode, number[]>();
  const pendingFunctions: Array<{
    functionNode: EsTreeNode;
    argumentValues: Array<EsTreeNode | null> | null;
  }> = [{ functionNode, argumentValues: null }];
  const visitedFunctions = new Set<EsTreeNode>();
  const enqueueFunction = (
    targetFunction: EsTreeNode,
    argumentValues: Array<EsTreeNode | null> | null,
    invocationStart: number,
  ): void => {
    const invocationStarts = invocationStartsByFunction.get(targetFunction) ?? [];
    invocationStarts.push(invocationStart);
    invocationStartsByFunction.set(targetFunction, invocationStarts);
    if (isFunctionLike(targetFunction)) {
      const expandedArgumentValues: Array<EsTreeNode | null> = [];
      let hasUnknownSpreadArgument = false;
      for (const argumentValue of argumentValues ?? []) {
        if (!isNodeOfType(argumentValue, "SpreadElement")) {
          expandedArgumentValues.push(argumentValue);
          continue;
        }
        if (
          isNodeOfType(argumentValue.argument, "ArrayExpression") &&
          argumentValue.argument.elements.every(
            (element) => !element || !isNodeOfType(element, "SpreadElement"),
          )
        ) {
          for (const element of argumentValue.argument.elements) {
            expandedArgumentValues.push(element);
          }
          continue;
        }
        hasUnknownSpreadArgument = true;
        break;
      }
      for (const [parameterIndex, parameter] of (targetFunction.params ?? []).entries()) {
        if (!isNodeOfType(parameter, "Identifier")) continue;
        const symbol = context.scopes.symbolFor(parameter);
        if (!symbol) continue;
        const argumentValue = expandedArgumentValues[parameterIndex] ?? null;
        if (hasUnknownSpreadArgument && parameterIndex >= expandedArgumentValues.length) {
          unknownSpreadParameterSymbolIds.add(symbol.id);
          continue;
        }
        if (!argumentValue) {
          unknownParameterSymbolIds.add(symbol.id);
          continue;
        }
        const existingValues = argumentValuesByParameterSymbolId.get(symbol.id) ?? [];
        existingValues.push(argumentValue);
        argumentValuesByParameterSymbolId.set(symbol.id, existingValues);
      }
    }
    pendingFunctions.push({ functionNode: targetFunction, argumentValues });
  };
  while (pendingFunctions.length > 0) {
    const pendingFunction = pendingFunctions.shift();
    const currentFunction = pendingFunction?.functionNode;
    if (
      !currentFunction ||
      visitedFunctions.has(currentFunction) ||
      !isFunctionLike(currentFunction)
    ) {
      continue;
    }
    visitedFunctions.add(currentFunction);
    bodies.push(currentFunction.body);
    walkAst(currentFunction.body, (node) => {
      if (node !== currentFunction.body && isFunctionLike(node)) {
        if (isImmediatelyInvokedFunction(node) && isNodeReachableWithinFunction(node, context)) {
          enqueueFunction(node, [], node.parent?.range[0] ?? node.range[0]);
        }
        return false;
      }
      if (!isNodeOfType(node, "CallExpression") && !isNodeOfType(node, "NewExpression")) return;
      if (!isNodeReachableWithinFunction(node, context)) return;
      if (isNodeOfType(node, "CallExpression")) {
        const localFunction = resolveLocalFunction(node.callee, context);
        if (localFunction) {
          enqueueFunction(
            localFunction,
            (node.arguments ?? []).map((argument) => argument),
            node.range[0],
          );
          return;
        }
        const callee = unwrapTypeWrappedCallee(node.callee);
        const calleeSymbol = callee ? context.scopes.symbolFor(callee) : null;
        if (calleeSymbol?.kind === "parameter") {
          for (const parameterValue of argumentValuesByParameterSymbolId.get(calleeSymbol.id) ??
            []) {
            const callbackFunction = resolveLocalFunction(parameterValue, context);
            if (!callbackFunction) continue;
            enqueueFunction(
              callbackFunction,
              (node.arguments ?? []).map((argument) => argument),
              node.range[0],
            );
          }
        }
      }
      for (const [argumentIndex, argument] of (node.arguments ?? []).entries()) {
        const callback = resolveLocalFunction(argument, context);
        if (!callback) continue;
        const callee = unwrapTypeWrappedCallee(node.callee);
        const methodName =
          callee && isNodeOfType(callee, "MemberExpression") ? getStaticPropertyName(callee) : null;
        const isTypedCollectionCallback = Boolean(
          callee &&
          isNodeOfType(callee, "MemberExpression") &&
          methodName &&
          argumentIndex === 0 &&
          SYNCHRONOUS_COLLECTION_CALLBACK_METHOD_NAMES.has(methodName) &&
          isProvenSynchronousCollection(callee.object, context) &&
          !hasStaticPropertyWriteBefore(callee.object, methodName, node, context.scopes),
        );
        if (
          isTypedCollectionCallback ||
          executesDuringRender(argument, context.scopes, {
            requireProvenSynchronousCallbackReceiver: true,
          })
        ) {
          let callbackArgumentValues: Array<EsTreeNode | null> | null = null;
          if (
            isNodeOfType(node, "CallExpression") &&
            isNodeOfType(node.callee, "MemberExpression") &&
            argumentIndex === 0 &&
            isNodeOfType(node.callee.object, "ArrayExpression")
          ) {
            callbackArgumentValues = [
              node.callee.object.elements.find(
                (element) => element && !isNodeOfType(element, "SpreadElement"),
              ) ?? null,
            ];
          } else if (
            isNodeOfType(node, "CallExpression") &&
            argumentIndex === 1 &&
            node.arguments[0] &&
            isNodeOfType(node.arguments[0], "ArrayExpression")
          ) {
            callbackArgumentValues = [
              node.arguments[0].elements.find(
                (element) => element && !isNodeOfType(element, "SpreadElement"),
              ) ?? null,
            ];
          }
          enqueueFunction(callback, callbackArgumentValues, node.range[0]);
        }
      }
    });
  }
  return {
    bodies,
    argumentValuesByParameterSymbolId,
    unknownParameterSymbolIds,
    unknownSpreadParameterSymbolIds,
    invocationStartsByFunction,
  };
};

const collectAuthScanRoots = (
  functionNode: AsyncFunctionLikeNode,
  context: RuleContext,
): EsTreeNode[] => {
  const roots: EsTreeNode[] = [];
  const pendingFunctions: EsTreeNode[] = [functionNode];
  const visitedFunctions = new Set<EsTreeNode>();
  while (pendingFunctions.length > 0) {
    const currentFunction = pendingFunctions.shift();
    if (
      !currentFunction ||
      visitedFunctions.has(currentFunction) ||
      !isFunctionLike(currentFunction)
    ) {
      continue;
    }
    visitedFunctions.add(currentFunction);
    const currentRoots = isNodeOfType(currentFunction.body, "BlockStatement")
      ? (currentFunction.body.body ?? []).slice(0, AUTH_CHECK_LOOKAHEAD_STATEMENTS)
      : [currentFunction.body];
    for (const currentRoot of currentRoots) {
      roots.push(currentRoot);
      walkAst(currentRoot, (node) => {
        if (node !== currentRoot && isFunctionLike(node)) {
          if (isImmediatelyInvokedFunction(node)) pendingFunctions.push(node);
          return false;
        }
        if (!isNodeOfType(node, "CallExpression")) return;
        if (
          !context.cfg.isUnconditionalFromEntry(node) ||
          isNodeConditionallyExecuted(node, currentRoot) ||
          !isNodeReachableWithinFunction(node, context)
        ) {
          return;
        }
        const firstMutationStart = getFirstPotentialMutationStart(currentRoot, context);
        if (firstMutationStart !== null && firstMutationStart < node.range[0]) return;
        const localFunction = resolveLocalFunction(node.callee, context);
        if (localFunction) pendingFunctions.push(localFunction);
      });
      if (getFirstPotentialMutationStart(currentRoot, context) !== null) break;
    }
  }
  return roots;
};

const isSafeRequestLocalType = (symbol: SymbolDescriptor, context: RuleContext): boolean => {
  const typeNode = getSymbolTypeAnnotation(symbol);
  return Boolean(
    typeNode &&
    isUnshadowedIntrinsicTypeReference(typeNode, SAFE_REQUEST_LOCAL_TYPE_NAMES, context),
  );
};

const isProvenSafeMutableSource = (node: EsTreeNode, context: RuleContext): boolean => {
  const expression = unwrapTypeWrappedCallee(node);
  if (!expression) return false;
  if (isNodeOfType(expression, "AwaitExpression")) {
    return isProvenSafeMutableSource(expression.argument, context);
  }
  if (
    isNodeOfType(expression, "NewExpression") &&
    isNodeOfType(expression.callee, "Identifier") &&
    SAFE_MUTABLE_CONSTRUCTOR_NAMES.has(expression.callee.name)
  ) {
    if (expression.callee.name === "NextResponse") {
      return (
        context.scopes.symbolFor(expression.callee)?.kind === "import" &&
        getImportedNameFromModule(expression, expression.callee.name, "next/server") ===
          "NextResponse"
      );
    }
    return context.scopes.isGlobalReference(expression.callee);
  }
  if (!isNodeOfType(expression, "CallExpression")) return false;
  const callee = unwrapTypeWrappedCallee(expression.callee);
  if (isNodeOfType(callee, "Identifier") && callee.name === "headers") {
    return (
      context.scopes.symbolFor(callee)?.kind === "import" &&
      getImportedNameFromModule(expression, callee.name, "next/headers") === "headers"
    );
  }
  if (
    isNodeOfType(callee, "Identifier") &&
    CRYPTO_BUILDER_FACTORY_NAMES.has(callee.name) &&
    context.scopes.symbolFor(callee)?.kind === "import"
  ) {
    return (
      getImportedNameFromModule(expression, callee.name, "node:crypto") === callee.name ||
      getImportedNameFromModule(expression, callee.name, "crypto") === callee.name
    );
  }
  if (
    !isNodeOfType(callee, "MemberExpression") ||
    callee.computed ||
    !isNodeOfType(callee.object, "Identifier") ||
    !isNodeOfType(callee.property, "Identifier") ||
    !RESPONSE_FACTORY_METHODS.has(callee.property.name)
  ) {
    return false;
  }
  if (callee.object.name === "Response") return context.scopes.isGlobalReference(callee.object);
  return (
    callee.object.name === "NextResponse" &&
    context.scopes.symbolFor(callee.object)?.kind === "import" &&
    getImportedNameFromModule(expression, callee.object.name, "next/server") === "NextResponse"
  );
};

const getExecutedAssignedValuesAtReference = (
  symbol: SymbolDescriptor,
  referenceNode: EsTreeNode,
  executionGraph: ExecutedFunctionGraph,
  context: RuleContext,
): EsTreeNode[] => {
  const referenceFunction = context.cfg.enclosingFunction(referenceNode);
  const sameFunctionAssignedValues = collectPossibleAssignedExpressions(
    symbol,
    referenceNode,
    context.cfg,
  ).filter((assignedExpression) => isNodeReachableWithinFunction(assignedExpression, context));
  const crossFunctionAssignedValues = symbol.references
    .flatMap((reference) => {
      if (reference.flag === "read") return [];
      const assignedExpression = getAssignedExpressionForWrite(reference.identifier);
      if (!assignedExpression || !isNodeReachableWithinFunction(assignedExpression, context)) {
        return [];
      }
      const writeFunction = context.cfg.enclosingFunction(reference.identifier);
      if (writeFunction === referenceFunction) return [];
      const invocationStarts = writeFunction
        ? (executionGraph.invocationStartsByFunction.get(writeFunction) ?? [])
        : [];
      const latestInvocationStart = invocationStarts
        .filter((invocationStart) => invocationStart < referenceNode.range[0])
        .sort((left, right) => right - left)[0];
      return latestInvocationStart === undefined
        ? []
        : [{ expression: assignedExpression, position: latestInvocationStart }];
    })
    .sort((left, right) => right.position - left.position);
  const latestCrossFunctionAssignment = crossFunctionAssignedValues[0];
  if (!latestCrossFunctionAssignment) return sameFunctionAssignedValues;
  const latestSameFunctionWritePosition = symbol.references
    .filter(
      (reference) =>
        reference.flag !== "read" &&
        context.cfg.enclosingFunction(reference.identifier) === referenceFunction &&
        reference.identifier.range[0] < referenceNode.range[0],
    )
    .reduce(
      (latestPosition, reference) => Math.max(latestPosition, reference.identifier.range[0]),
      symbol.initializer ? symbol.bindingIdentifier.range[0] : -1,
    );
  return latestSameFunctionWritePosition > latestCrossFunctionAssignment.position
    ? sameFunctionAssignedValues
    : [latestCrossFunctionAssignment.expression];
};

const getParameterValuesAtReference = (
  symbol: SymbolDescriptor,
  referenceNode: EsTreeNode,
  executionGraph: ExecutedFunctionGraph,
  context: RuleContext,
): EsTreeNode[] => {
  const assignedValues = getExecutedAssignedValuesAtReference(
    symbol,
    referenceNode,
    executionGraph,
    context,
  );
  if (assignedValues.length > 0) return [assignedValues[0]];
  return executionGraph.argumentValuesByParameterSymbolId.get(symbol.id) ?? [];
};

const isSafeReceiverForServerAction = (
  receiverNode: EsTreeNode,
  context: RuleContext,
  executionGraph: ExecutedFunctionGraph,
  visitedSymbolIds: Set<number> = new Set(),
): boolean => {
  let currentNode: EsTreeNode | null = receiverNode;
  while (currentNode) {
    const unwrapped = unwrapTypeWrappedCallee(currentNode);
    if (!unwrapped) return false;
    if (isProvenSafeMutableSource(unwrapped, context)) return true;
    if (isNodeOfType(unwrapped, "Identifier")) {
      const symbol = context.scopes.symbolFor(unwrapped);
      if (!symbol || visitedSymbolIds.has(symbol.id)) return false;
      visitedSymbolIds.add(symbol.id);
      if (symbol.kind === "parameter") {
        if (executionGraph.unknownSpreadParameterSymbolIds.has(symbol.id)) return false;
        const parameterValues = getParameterValuesAtReference(
          symbol,
          unwrapped,
          executionGraph,
          context,
        );
        if (parameterValues.length > 0) {
          return parameterValues.every((parameterValue) =>
            isSafeReceiverForServerAction(
              parameterValue,
              context,
              executionGraph,
              new Set(visitedSymbolIds),
            ),
          );
        }
        if (isSafeRequestLocalType(symbol, context)) return true;
        return executionGraph.unknownParameterSymbolIds.has(symbol.id);
      }
      const executedAssignedValues = getExecutedAssignedValuesAtReference(
        symbol,
        unwrapped,
        executionGraph,
        context,
      );
      if (executedAssignedValues.length > 0) {
        return executedAssignedValues.every((assignedValue) =>
          isSafeReceiverForServerAction(
            assignedValue,
            context,
            executionGraph,
            new Set(visitedSymbolIds),
          ),
        );
      }
      const assignedExpressions = collectPossibleAssignedExpressions(
        symbol,
        unwrapped,
        context.cfg,
      );
      return (
        assignedExpressions.length > 0 &&
        assignedExpressions.every((assignedExpression) =>
          isSafeReceiverForServerAction(
            assignedExpression,
            context,
            executionGraph,
            new Set(visitedSymbolIds),
          ),
        )
      );
    }
    if (isNodeOfType(unwrapped, "MemberExpression")) {
      const propertyName = getStaticPropertyName(unwrapped);
      if (propertyName !== "headers" && propertyName !== "searchParams") return false;
      currentNode = unwrapped.object;
      continue;
    }
    if (isNodeOfType(unwrapped, "AwaitExpression")) {
      currentNode = unwrapped.argument;
      continue;
    }
    return false;
  }
  return false;
};

const isCookiesCall = (node: EsTreeNode, context: RuleContext): boolean => {
  const expression = unwrapTypeWrappedCallee(node);
  if (!expression) return false;
  if (isNodeOfType(expression, "AwaitExpression"))
    return isCookiesCall(expression.argument, context);
  if (
    !isNodeOfType(expression, "CallExpression") ||
    !isNodeOfType(expression.callee, "Identifier") ||
    expression.callee.name !== "cookies"
  ) {
    return false;
  }
  return (
    context.scopes.symbolFor(expression.callee)?.kind === "import" &&
    getImportedNameFromModule(expression, expression.callee.name, "next/headers") === "cookies"
  );
};

const isCookieReceiverForServerAction = (
  receiverNode: EsTreeNode,
  context: RuleContext,
  executionGraph: ExecutedFunctionGraph,
  visitedSymbolIds: Set<number> = new Set(),
): boolean => {
  const node = unwrapTypeWrappedCallee(receiverNode);
  if (!node) return false;
  if (isCookiesCall(node, context)) return true;
  if (!isNodeOfType(node, "Identifier")) return false;
  const symbol = context.scopes.symbolFor(node);
  if (!symbol || visitedSymbolIds.has(symbol.id)) return false;
  visitedSymbolIds.add(symbol.id);
  if (symbol.kind === "parameter") {
    const parameterValues = getParameterValuesAtReference(symbol, node, executionGraph, context);
    return (
      parameterValues.length > 0 &&
      parameterValues.every((parameterValue) =>
        isCookieReceiverForServerAction(
          parameterValue,
          context,
          executionGraph,
          new Set(visitedSymbolIds),
        ),
      )
    );
  }
  const executedAssignedValues = getExecutedAssignedValuesAtReference(
    symbol,
    node,
    executionGraph,
    context,
  );
  if (executedAssignedValues.length > 0) {
    return executedAssignedValues.every((assignedValue) =>
      isCookieReceiverForServerAction(
        assignedValue,
        context,
        executionGraph,
        new Set(visitedSymbolIds),
      ),
    );
  }
  const assignedExpressions = collectPossibleAssignedExpressions(symbol, node, context.cfg);
  return (
    assignedExpressions.length > 0 &&
    assignedExpressions.every((assignedExpression) =>
      isCookieReceiverForServerAction(
        assignedExpression,
        context,
        executionGraph,
        new Set(visitedSymbolIds),
      ),
    )
  );
};

const walkExecutedServerActionNodes = (
  rootNode: EsTreeNode,
  context: RuleContext,
  visitNode: (node: EsTreeNode) => void | false,
): void => {
  walkAst(rootNode, (node: EsTreeNode) => {
    if (isStaticallyUnreachableExecutionNode(node, context)) {
      return isFunctionLike(node) ? false : undefined;
    }
    if (node !== rootNode && isFunctionLike(node) && !isImmediatelyInvokedFunction(node)) {
      return false;
    }
    return visitNode(node);
  });
};

const isChatOpenAiConstruction = (node: EsTreeNode, context: RuleContext): boolean => {
  if (!isNodeOfType(node, "NewExpression") || !isNodeOfType(node.callee, "Identifier")) {
    return false;
  }
  const symbol = context.scopes.symbolFor(node.callee);
  return (
    symbol?.kind === "import" &&
    getImportedNameFromModule(node, node.callee.name, "@langchain/openai") === "ChatOpenAI"
  );
};

const isTrackedLangchainExpression = (
  expression: EsTreeNode,
  context: RuleContext,
  executionGraph: ExecutedFunctionGraph,
  visitedSymbolIds: Set<number> = new Set(),
): boolean => {
  const node = unwrapTypeWrappedCallee(expression);
  if (!node) return false;
  if (isChatOpenAiConstruction(node, context)) return true;
  if (isNodeOfType(node, "Identifier")) {
    const symbol = context.scopes.symbolFor(node);
    if (!symbol || visitedSymbolIds.has(symbol.id)) return false;
    visitedSymbolIds.add(symbol.id);
    if (symbol.kind === "parameter") {
      const parameterValues = getParameterValuesAtReference(symbol, node, executionGraph, context);
      return (
        parameterValues.length > 0 &&
        parameterValues.every((parameterValue) =>
          isTrackedLangchainExpression(
            parameterValue,
            context,
            executionGraph,
            new Set(visitedSymbolIds),
          ),
        )
      );
    }
    const executedAssignedValues = getExecutedAssignedValuesAtReference(
      symbol,
      node,
      executionGraph,
      context,
    );
    if (executedAssignedValues.length > 0) {
      return executedAssignedValues.every((assignedValue) =>
        isTrackedLangchainExpression(
          assignedValue,
          context,
          executionGraph,
          new Set(visitedSymbolIds),
        ),
      );
    }
    const assignedExpressions = collectPossibleAssignedExpressions(symbol, node, context.cfg);
    return (
      assignedExpressions.length > 0 &&
      assignedExpressions.every((assignedExpression) =>
        isTrackedLangchainExpression(
          assignedExpression,
          context,
          executionGraph,
          new Set(visitedSymbolIds),
        ),
      )
    );
  }
  if (
    !isNodeOfType(node, "CallExpression") ||
    !isNodeOfType(node.callee, "MemberExpression") ||
    node.callee.computed ||
    !isNodeOfType(node.callee.property, "Identifier") ||
    !LANGCHAIN_CHAINING_METHOD_NAMES.has(node.callee.property.name)
  ) {
    return false;
  }
  if (
    isTrackedLangchainExpression(
      node.callee.object,
      context,
      executionGraph,
      new Set(visitedSymbolIds),
    )
  ) {
    return true;
  }
  return node.arguments.some((argument) =>
    isTrackedLangchainExpression(argument, context, executionGraph, new Set(visitedSymbolIds)),
  );
};

const findBillableLangchainCall = (
  executionGraph: ExecutedFunctionGraph,
  context: RuleContext,
): string | null => {
  let billableMethodName: string | null = null;
  for (const executedBody of executionGraph.bodies) {
    walkExecutedServerActionNodes(executedBody, context, (node) => {
      if (
        !isNodeOfType(node, "CallExpression") ||
        !isNodeOfType(node.callee, "MemberExpression") ||
        node.callee.computed ||
        !isNodeOfType(node.callee.property, "Identifier") ||
        !BILLABLE_LANGCHAIN_METHOD_NAMES.has(node.callee.property.name) ||
        !isTrackedLangchainExpression(node.callee.object, context, executionGraph)
      ) {
        return;
      }
      billableMethodName = node.callee.property.name;
      return false;
    });
    if (billableMethodName) break;
  }
  return billableMethodName ? `ChatOpenAI.${billableMethodName}()` : null;
};

const getModuleStateMutationDescription = (
  node: EsTreeNode,
  context: RuleContext,
): string | null => {
  let target: EsTreeNode | null = null;
  let operation = "mutation";
  if (isNodeOfType(node, "AssignmentExpression")) {
    target = node.left;
    operation = "assignment";
  } else if (isNodeOfType(node, "UpdateExpression")) {
    target = node.argument;
    operation = "update";
  } else if (isNodeOfType(node, "UnaryExpression") && node.operator === "delete") {
    target = node.argument;
    operation = "deletion";
  }
  if (!target) return null;
  const rootIdentifier = getRootIdentifier(target);
  if (!rootIdentifier) return null;
  const rootSymbol = context.scopes.symbolFor(rootIdentifier);
  const isModuleState = rootSymbol?.scope.kind === "module";
  const isGlobalState =
    context.scopes.isGlobalReference(rootIdentifier) && rootIdentifier.name === "globalThis";
  return isModuleState || isGlobalState ? `${rootIdentifier.name} module-state ${operation}` : null;
};

const getMutatingSqlTaggedTemplateDescription = (
  node: EsTreeNode,
  context: RuleContext,
): string | null => {
  if (!isNodeOfType(node, "TaggedTemplateExpression")) return null;
  const tag = unwrapTypeWrappedCallee(node.tag);
  const isNamedSqlImport = Boolean(
    isNodeOfType(tag, "Identifier") &&
    context.scopes.symbolFor(tag)?.kind === "import" &&
    getImportedNameFromModule(tag, tag.name, "@vercel/postgres") === "sql",
  );
  const namespaceReceiver =
    isNodeOfType(tag, "MemberExpression") && getStaticPropertyName(tag) === "sql"
      ? unwrapTypeWrappedCallee(tag.object)
      : null;
  const namespaceBinding = isNodeOfType(namespaceReceiver, "Identifier")
    ? getImportBindingForName(namespaceReceiver, namespaceReceiver.name)
    : null;
  const isNamespaceSqlImport = Boolean(
    isNodeOfType(namespaceReceiver, "Identifier") &&
    context.scopes.symbolFor(namespaceReceiver)?.kind === "import" &&
    namespaceBinding?.isNamespace &&
    namespaceBinding.source === "@vercel/postgres",
  );
  if (!isNamedSqlImport && !isNamespaceSqlImport) return null;
  const statementPrefix = node.quasi.quasis[0]?.value.raw ?? "";
  const statementWithoutLeadingComments = statementPrefix.replace(SQL_LEADING_COMMENT_PATTERN, "");
  const statementMatch = MUTATING_SQL_STATEMENT_PATTERN.exec(statementWithoutLeadingComments);
  return statementMatch ? `sql tagged-template ${statementMatch[0].trim().toUpperCase()}` : null;
};

const isLikelySecretName = (name: string): boolean => {
  if (!SECRET_VARIABLE_PATTERN.test(name)) return false;
  const nameTokens = tokenizeIdentifierWords(name);
  if (nameTokens.some((nameToken) => PUBLIC_SECRET_NAME_TOKENS.has(nameToken))) return false;
  const finalToken = nameTokens.at(-1);
  return !finalToken || !SECRET_METADATA_SUFFIX_TOKENS.has(finalToken);
};

const expressionOriginatesFromModuleBinding = (
  expression: EsTreeNode,
  context: RuleContext,
  visitedSymbolIds = new Set<number>(),
): boolean => {
  const node = unwrapTypeWrappedCallee(expression);
  if (!node) return false;
  if (isNodeOfType(node, "MemberExpression")) {
    return expressionOriginatesFromModuleBinding(node.object, context, visitedSymbolIds);
  }
  if (!isNodeOfType(node, "Identifier")) return false;
  const symbol = context.scopes.symbolFor(node);
  if (!symbol || visitedSymbolIds.has(symbol.id)) return false;
  if (symbol.scope.kind === "module") return true;
  visitedSymbolIds.add(symbol.id);
  return collectPossibleAssignedExpressions(symbol, node, context.cfg).some((assignedExpression) =>
    expressionOriginatesFromModuleBinding(assignedExpression, context, new Set(visitedSymbolIds)),
  );
};

const getSecretModuleBindingName = (
  identifier: EsTreeNodeOfType<"Identifier">,
  context: RuleContext,
): string | null => {
  const symbol = context.scopes.symbolFor(identifier);
  if (!symbol || symbol.scope.kind !== "module") return null;
  const importBinding =
    symbol.kind === "import" ? getImportBindingForName(identifier, identifier.name) : null;
  const bindingName =
    importBinding && !importBinding.isNamespace && importBinding.exportedName !== "default"
      ? (importBinding.exportedName ?? identifier.name)
      : identifier.name;
  return isLikelySecretName(bindingName) ? bindingName : null;
};

const getLeakedModuleSecretName = (
  expression: EsTreeNode,
  context: RuleContext,
  visitedSymbolIds = new Set<number>(),
): string | null => {
  const node = unwrapTypeWrappedCallee(expression);
  if (!node || isFunctionLike(node)) return null;
  if (isNodeOfType(node, "Identifier")) {
    const directSecretName = getSecretModuleBindingName(node, context);
    if (directSecretName) return directSecretName;
    const symbol = context.scopes.symbolFor(node);
    if (!symbol || visitedSymbolIds.has(symbol.id)) return null;
    visitedSymbolIds.add(symbol.id);
    for (const assignedExpression of collectPossibleAssignedExpressions(
      symbol,
      node,
      context.cfg,
    )) {
      const secretName = getLeakedModuleSecretName(
        assignedExpression,
        context,
        new Set(visitedSymbolIds),
      );
      if (secretName) return secretName;
    }
    return null;
  }
  if (isNodeOfType(node, "MemberExpression")) {
    const propertyName = getStaticPropertyName(node);
    return propertyName &&
      isLikelySecretName(propertyName) &&
      expressionOriginatesFromModuleBinding(node.object, context)
      ? propertyName
      : null;
  }
  if (isNodeOfType(node, "AwaitExpression")) {
    return getLeakedModuleSecretName(node.argument, context, visitedSymbolIds);
  }
  if (isNodeOfType(node, "ArrayExpression")) {
    for (const element of node.elements) {
      if (!element || isNodeOfType(element, "SpreadElement")) continue;
      const secretName = getLeakedModuleSecretName(element, context, new Set(visitedSymbolIds));
      if (secretName) return secretName;
    }
    return null;
  }
  if (isNodeOfType(node, "ObjectExpression")) {
    for (const property of node.properties) {
      if (!isNodeOfType(property, "Property") || property.kind !== "init") continue;
      const secretName = getLeakedModuleSecretName(
        property.value,
        context,
        new Set(visitedSymbolIds),
      );
      if (secretName) return secretName;
    }
    return null;
  }
  if (isNodeOfType(node, "ConditionalExpression")) {
    return (
      getLeakedModuleSecretName(node.consequent, context, new Set(visitedSymbolIds)) ??
      getLeakedModuleSecretName(node.alternate, context, new Set(visitedSymbolIds))
    );
  }
  if (isNodeOfType(node, "LogicalExpression") || isNodeOfType(node, "BinaryExpression")) {
    return (
      getLeakedModuleSecretName(node.left, context, new Set(visitedSymbolIds)) ??
      getLeakedModuleSecretName(node.right, context, new Set(visitedSymbolIds))
    );
  }
  if (isNodeOfType(node, "SequenceExpression")) {
    for (const sequenceExpression of node.expressions) {
      const secretName = getLeakedModuleSecretName(
        sequenceExpression,
        context,
        new Set(visitedSymbolIds),
      );
      if (secretName) return secretName;
    }
    return null;
  }
  if (isNodeOfType(node, "TemplateLiteral")) {
    for (const templateExpression of node.expressions) {
      const secretName = getLeakedModuleSecretName(
        templateExpression,
        context,
        new Set(visitedSymbolIds),
      );
      if (secretName) return secretName;
    }
  }
  return null;
};

const findReturnedModuleSecretName = (
  functionNode: AsyncFunctionLikeNode,
  context: RuleContext,
): string | null => {
  if (!isNodeOfType(functionNode.body, "BlockStatement")) {
    return getLeakedModuleSecretName(functionNode.body, context);
  }
  let secretName: string | null = null;
  walkAst(functionNode.body, (node) => {
    if (secretName) return false;
    if (node !== functionNode.body && isFunctionLike(node)) return false;
    if (!isNodeOfType(node, "ReturnStatement") || !node.argument) return;
    secretName = getLeakedModuleSecretName(node.argument, context);
    return secretName ? false : undefined;
  });
  return secretName;
};

const findDirectPrivilegedStateMutation = (
  executionGraph: ExecutedFunctionGraph,
  context: RuleContext,
): string | null => {
  let mutationDescription: string | null = null;
  for (const executedBody of executionGraph.bodies) {
    walkExecutedServerActionNodes(executedBody, context, (node) => {
      if (mutationDescription) return false;
      const importedMutationCallName = getImportedMutationCallName(node, context);
      const matchingMutationDescription = importedMutationCallName
        ? `imported ${importedMutationCallName}()`
        : (getModuleStateMutationDescription(node, context) ??
          getMutatingSqlTaggedTemplateDescription(node, context));
      if (!matchingMutationDescription) return;
      mutationDescription = matchingMutationDescription;
      return false;
    });
    if (mutationDescription) break;
  }
  return mutationDescription;
};

const containsJsxOutsideNestedFunctions = (rootNode: EsTreeNode): boolean => {
  let containsJsx = false;
  walkAst(rootNode, (child: EsTreeNode) => {
    if (containsJsx) return false;
    if (child !== rootNode && isFunctionLike(child)) return false;
    if (isNodeOfType(child, "JSXElement") || isNodeOfType(child, "JSXFragment")) {
      containsJsx = true;
      return false;
    }
  });
  return containsJsx;
};

const isComponentLikeServerExport = (candidate: ServerActionCandidate): boolean => {
  if (!COMPONENT_NAME_PATTERN.test(candidate.displayName)) return false;
  const functionBody = candidate.functionNode.body;
  if (!isNodeOfType(functionBody, "BlockStatement")) {
    return containsJsxOutsideNestedFunctions(functionBody);
  }

  let hasReturnedJsx = false;
  walkAst(functionBody, (child: EsTreeNode) => {
    if (hasReturnedJsx) return false;
    if (child !== functionBody && isFunctionLike(child)) return false;
    if (!isNodeOfType(child, "ReturnStatement") || !child.argument) return;
    hasReturnedJsx = containsJsxOutsideNestedFunctions(child.argument);
    return false;
  });
  return hasReturnedJsx;
};

// `signIn` / `logIn` / `signUp` tokenize as two words; merge them so the
// standalone-token check reads them as one credential phrase.
const CREDENTIAL_MERGE_TAIL_TOKENS: Readonly<Record<string, ReadonlySet<string>>> = {
  sign: new Set(["in", "up", "on"]),
  log: new Set(["in"]),
};

const mergeCredentialPhraseTokens = (tokens: string[]): string[] => {
  const mergedTokens: string[] = [];
  for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex += 1) {
    const currentToken = tokens[tokenIndex];
    const tailTokens = CREDENTIAL_MERGE_TAIL_TOKENS[currentToken];
    const nextToken = tokens[tokenIndex + 1];
    if (tailTokens && nextToken && tailTokens.has(nextToken)) {
      mergedTokens.push(`${currentToken}${nextToken}`);
      tokenIndex += 1;
      continue;
    }
    mergedTokens.push(currentToken);
  }
  return mergedTokens;
};

const CREDENTIAL_OPERATION_NAMES: ReadonlySet<string> = new Set([
  "login",
  "signin",
  "signup",
  "signon",
  "register",
  "registration",
  "oauth",
  "oauthcallback",
  "otp",
  "verifyotp",
  "confirmotp",
  "verifyemail",
  "confirmemail",
  "verifycode",
  "confirmcode",
  "resetpassword",
  "forgotpassword",
  "recoverpassword",
  "magiclink",
]);

// A credential-establishing action (login, signup, OAuth callback, OTP /
// email verify, password reset) legitimately runs for anonymous callers —
// no prior session can exist, so demanding an auth() gate on it is wrong.
const isCredentialEstablishingActionName = (actionName: string): boolean => {
  const tokens = mergeCredentialPhraseTokens(tokenizeIdentifierWords(actionName));
  const operationTokens = tokens.at(-1) === "action" ? tokens.slice(0, -1) : tokens;
  return CREDENTIAL_OPERATION_NAMES.has(operationTokens.join(""));
};

// Naming an exported action "public" (`getPostPublicAction`) declares the
// no-auth exposure on purpose; flagging it asks the author to gate an
// endpoint they deliberately opened.
const hasPublicNameToken = (actionName: string): boolean =>
  tokenizeIdentifierWords(actionName).includes("public");

const inspectServerAction = (
  candidate: ServerActionCandidate,
  fileHasUseServerDirective: boolean,
  allowedFunctionNames: ReadonlySet<string>,
  customAuthFunctionNames: ReadonlySet<string>,
  context: RuleContext,
): void => {
  const isServerAction = fileHasUseServerDirective || hasUseServerDirective(candidate.functionNode);
  if (!isServerAction) return;

  if (isComponentLikeServerExport(candidate)) return;
  if (isCredentialEstablishingActionName(candidate.displayName)) return;
  if (hasPublicNameToken(candidate.displayName)) return;

  const executionGraph = collectExecutedFunctionBodies(candidate.functionNode, context);
  const rootNodes = collectAuthScanRoots(candidate.functionNode, context);
  if (
    containsAuthCheck(
      rootNodes,
      allowedFunctionNames,
      GENERIC_AUTH_METHOD_NAMES,
      customAuthFunctionNames,
      context,
    )
  ) {
    return;
  }

  const returnedModuleSecretName = findReturnedModuleSecretName(candidate.functionNode, context);
  if (returnedModuleSecretName) {
    context.report({
      node: candidate.reportNode,
      message: `Server action "${candidate.displayName}" returns the module-scoped secret "${returnedModuleSecretName}" without authentication, so anyone can retrieve it directly.`,
    });
    return;
  }

  if (executionGraph.bodies.length === 1 && isNonPrivilegedServerAction(candidate.functionNode)) {
    return;
  }

  let sideEffect: string | null = null;
  for (const executedBody of executionGraph.bodies) {
    walkExecutedServerActionNodes(executedBody, context, (node) => {
      if (sideEffect) return false;
      if (!isNodeOfType(node, "CallExpression")) return;
      sideEffect = findSideEffect(node, {
        locallyScopedSafeBindings: new Set(),
        locallyScopedCookieBindings: new Set(),
        shouldTraverseNestedFunction: () => false,
        isSafeReceiver: (receiverNode) =>
          isSafeReceiverForServerAction(receiverNode, context, executionGraph),
        isCookieReceiver: (receiverNode) =>
          isCookieReceiverForServerAction(receiverNode, context, executionGraph),
        useDefaultSafeReceiverDetection: false,
        useDefaultCookieReceiverDetection: false,
      });
      return sideEffect ? false : undefined;
    });
    if (sideEffect) break;
  }
  sideEffect ??= findDirectPrivilegedStateMutation(executionGraph, context);
  sideEffect ??= findBillableLangchainCall(executionGraph, context);
  if (!sideEffect) return;

  context.report({
    node: candidate.reportNode,
    message: `Server action "${candidate.displayName}" performs unauthenticated privileged server work (${sideEffect}), so anyone can trigger it directly.`,
  });
};

const collectCandidatesFromVariableDeclaration = (
  variableDeclaration: EsTreeNodeOfType<"VariableDeclaration">,
): ServerActionCandidate[] => {
  const candidates: ServerActionCandidate[] = [];
  for (const declarator of variableDeclaration.declarations ?? []) {
    if (!isAsyncFunctionLikeNode(declarator.init)) continue;
    const bindingNode = isNodeOfType(declarator.id, "Identifier") ? declarator.id : null;
    candidates.push({
      functionNode: declarator.init,
      displayName: bindingNode?.name ?? "anonymous",
      reportNode: bindingNode ?? declarator,
    });
  }
  return candidates;
};

const getCandidateFromDefaultDeclaration = (
  node: EsTreeNodeOfType<"ExportDefaultDeclaration">,
): ServerActionCandidate | null => {
  const declaration = node.declaration;
  if (!isAsyncFunctionLikeNode(declaration)) return null;
  // Only FunctionDeclaration / FunctionExpression carry an `id`;
  // arrow functions never do. Fall back to "default" when missing.
  const functionId =
    (isNodeOfType(declaration, "FunctionDeclaration") ||
      isNodeOfType(declaration, "FunctionExpression")) &&
    declaration.id
      ? declaration.id
      : null;
  return {
    functionNode: declaration,
    displayName: functionId?.name ?? "default",
    reportNode: functionId ?? node,
  };
};

export const serverAuthActions = defineRule({
  id: "server-auth-actions",
  title: "Unauthenticated server action can be called directly",
  severity: "error",
  recommendation:
    "Check auth before changing server state or invoking billable services because exported server actions can be called directly by unauthenticated clients.",
  create: (context: RuleContext): RuleVisitors => {
    const isAppRouterSource = APP_ROUTER_SOURCE_PATH_PATTERN.test(context.filename ?? "");
    const isNonProductionFile = isAppRouterSource
      ? isTestlikeFilenameIgnoringPathSegments(
          context.filename,
          APP_ROUTER_PRODUCTION_PATH_SEGMENTS,
        )
      : isTestlikeFilename(context.filename);
    if (isNonProductionFile) {
      return {};
    }
    const shouldSkipTestAppSource = Boolean(
      context.filename && TEST_APP_SOURCE_PATH_PATTERN.test(context.filename),
    );
    let fileHasUseServerDirective = false;
    let programNode: EsTreeNodeOfType<"Program"> | null = null;
    const inspectedFunctions = new Set<AsyncFunctionLikeNode>();
    const customAuthFunctionNames = getReactDoctorStringArraySetting(
      context.settings,
      "serverAuthFunctionNames",
    );
    const customAuthFunctionNameSet = new Set(customAuthFunctionNames);
    // Custom auth guards from project config are treated as distinctive
    // (NOT generic) — when a project opts a name in, the user has
    // already vouched that the name uniquely identifies an auth check.
    const allowedFunctionNames: ReadonlySet<string> =
      customAuthFunctionNames.length > 0
        ? new Set([...AUTH_FUNCTION_NAMES, ...customAuthFunctionNames])
        : AUTH_FUNCTION_NAMES;

    const inspect = (candidate: ServerActionCandidate): void => {
      if (inspectedFunctions.has(candidate.functionNode)) return;
      inspectedFunctions.add(candidate.functionNode);
      inspectServerAction(
        candidate,
        fileHasUseServerDirective,
        allowedFunctionNames,
        customAuthFunctionNameSet,
        context,
      );
    };

    return {
      Program(currentProgramNode: EsTreeNodeOfType<"Program">) {
        programNode = currentProgramNode;
        fileHasUseServerDirective = hasDirective(currentProgramNode, "use server");
      },
      ExportNamedDeclaration(node: EsTreeNodeOfType<"ExportNamedDeclaration">) {
        if (shouldSkipTestAppSource) return;
        const declaration = node.declaration;
        if (!declaration) {
          if (!programNode || node.source || node.exportKind === "type") return;
          for (const specifier of node.specifiers ?? []) {
            if (!isNodeOfType(specifier, "ExportSpecifier") || specifier.exportKind === "type") {
              continue;
            }
            const exportedName = isNodeOfType(specifier.exported, "Identifier")
              ? specifier.exported.name
              : isNodeOfType(specifier.exported, "Literal") &&
                  typeof specifier.exported.value === "string"
                ? specifier.exported.value
                : null;
            if (!exportedName) continue;
            const exportedValue = findExportedValue(programNode, exportedName);
            if (!isAsyncFunctionLikeNode(exportedValue)) continue;
            const localName = isNodeOfType(specifier.local, "Identifier")
              ? specifier.local.name
              : exportedName;
            inspect({
              functionNode: exportedValue,
              displayName: localName,
              reportNode: specifier.local ?? specifier,
            });
          }
          return;
        }
        if (isAsyncFunctionLikeNode(declaration)) {
          if (!isNodeOfType(declaration, "FunctionDeclaration")) return;
          inspect({
            functionNode: declaration,
            displayName: declaration.id?.name ?? "anonymous",
            reportNode: declaration.id ?? node,
          });
          return;
        }
        if (isNodeOfType(declaration, "VariableDeclaration")) {
          for (const candidate of collectCandidatesFromVariableDeclaration(declaration)) {
            inspect(candidate);
          }
        }
      },
      ExportDefaultDeclaration(node: EsTreeNodeOfType<"ExportDefaultDeclaration">) {
        if (shouldSkipTestAppSource) return;
        const directCandidate = getCandidateFromDefaultDeclaration(node);
        if (directCandidate) {
          inspect(directCandidate);
          return;
        }
        if (!programNode) return;
        const resolvedDefaultExport = findExportedValue(programNode, "default");
        const candidate = isAsyncFunctionLikeNode(resolvedDefaultExport)
          ? {
              functionNode: resolvedDefaultExport,
              displayName: isNodeOfType(node.declaration, "Identifier")
                ? node.declaration.name
                : "default",
              reportNode: node.declaration ?? node,
            }
          : null;
        if (candidate) inspect(candidate);
      },
    };
  },
});
