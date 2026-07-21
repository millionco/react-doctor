import * as path from "node:path";
import {
  NEXTJS_SOURCE_FILE_EXTENSION_GROUP,
  ROUTE_HANDLER_HTTP_METHODS,
} from "../../constants/nextjs.js";
import { MUTATING_ARRAY_METHODS, PROMISE_SETTLE_METHODS } from "../../constants/js.js";
import type { BasicBlock } from "../../semantic/control-flow-graph.js";
import type { SymbolDescriptor } from "../../semantic/scope-analysis.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { executesDuringRender } from "../../utils/executes-during-render.js";
import {
  getImportedNameFromModule,
  isNamespaceImportFromModule,
} from "../../utils/find-import-source-for-name.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { findExportedValue } from "../../utils/find-exported-value.js";
import { findProgramRoot } from "../../utils/find-program-root.js";
import { findVisibleSymbol } from "../../utils/find-visible-symbol.js";
import { hasCapability } from "../../utils/get-react-doctor-setting.js";
import { getResolvedStaticPropertyName } from "../../utils/get-resolved-static-property-name.js";
import { getSingleReturnExpression } from "../../utils/get-single-return-expression.js";
import { getNodeStartIndex } from "../../utils/get-node-start-index.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isAstNode } from "../../utils/is-ast-node.js";
import { isAstDescendant } from "../../utils/is-ast-descendant.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isFrameworkRouteOrSpecialFilename } from "../../utils/is-framework-route-or-special-filename.js";
import { isInProjectDirectory } from "../../utils/is-in-project-directory.js";
import { isNextjsMetadataImageRouteFilename } from "../../utils/is-nextjs-metadata-image-route-filename.js";
import { isNodeReachableWithinFunction } from "../../utils/is-node-reachable-within-function.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactApiCall } from "../../utils/is-react-api-call.js";
import { nodeDominatesNode } from "../../utils/node-dominates-node.js";
import { normalizeFilename } from "../../utils/normalize-filename.js";
import { resolveConstIdentifierAlias } from "../../utils/resolve-const-identifier-alias.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { statementAlwaysExits } from "../../utils/statement-always-exits.js";
import {
  stripParenExpression,
  TRANSPARENT_EXPRESSION_WRAPPER_TYPES,
} from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";

const DYNAMIC_API_NAMES: ReadonlySet<string> = new Set(["cookies", "headers", "draftMode"]);
const UNSAFE_UNWRAPPED_TYPE_NAMES: ReadonlySet<string> = new Set([
  "UnsafeUnwrappedCookies",
  "UnsafeUnwrappedHeaders",
  "UnsafeUnwrappedDraftMode",
]);
const OBJECT_ENUMERATION_METHOD_NAMES: ReadonlySet<string> = new Set([
  "entries",
  "getOwnPropertyDescriptor",
  "getOwnPropertyDescriptors",
  "getOwnPropertyNames",
  "getOwnPropertySymbols",
  "keys",
  "values",
]);
const ITERABLE_CONSTRUCTOR_NAMES: ReadonlySet<string> = new Set([
  "Headers",
  "Map",
  "Set",
  "URLSearchParams",
  "WeakMap",
  "WeakSet",
]);
const COERCIVE_GLOBAL_NAMES: ReadonlySet<string> = new Set([
  "BigInt",
  "Boolean",
  "decodeURI",
  "decodeURIComponent",
  "Number",
  "String",
  "encodeURI",
  "encodeURIComponent",
  "isFinite",
  "isNaN",
  "parseFloat",
  "parseInt",
]);
const NON_CONSUMING_UNARY_OPERATORS: ReadonlySet<string> = new Set(["!", "typeof", "void"]);
const SITEMAP_FILE_PATTERN = new RegExp(`^sitemap\\.${NEXTJS_SOURCE_FILE_EXTENSION_GROUP}$`);
const MESSAGE =
  "This Next.js request API returns a Promise. Synchronous property access warns in Next.js 15 and is removed in Next.js 16; await it or unwrap it with React `use()`.";

interface PendingSymbolCandidate {
  sourceExpression: EsTreeNode;
  symbol: SymbolDescriptor;
}

interface PendingSymbolFlow {
  isClearedAtExit: boolean;
  isClearedBefore: (referenceIdentifier: EsTreeNode) => boolean;
}

interface ExitingCatchClearing {
  clearingNode: EsTreeNode;
  tryStatement: EsTreeNode;
}

interface ConditionalClearingBranches {
  hasAlternate: boolean;
  hasConsequent: boolean;
}

interface ExecutionProjectionOptions {
  requiresGuaranteedExecution: boolean;
}

interface AsyncExecutionPhase {
  mayExecuteBeforeSuspension: boolean;
  mustExecuteBeforeSuspension: boolean;
}

interface DirectInvocationSiteOptions {
  includeCallbackExecutionSites: boolean;
  requireGuaranteedCallbackExecution?: boolean;
}

interface KnownArrayCardinality {
  comparableElementCount: number;
  length: number;
  presentElementCount: number;
}

interface ProjectedClearingSitesInput {
  afterStart: number;
  context: RuleContext;
  symbol: SymbolDescriptor;
  targetOwner: EsTreeNode | null;
}

const resolvesToImportBinding = (context: RuleContext, identifier: EsTreeNode): boolean =>
  findVisibleSymbol(identifier, context.scopes)?.kind === "import";

const getStaticStringValue = (context: RuleContext, expression: EsTreeNode): string | null => {
  const node = stripParenExpression(expression);
  if (isNodeOfType(node, "Literal") && typeof node.value === "string") return node.value;
  if (!isNodeOfType(node, "Identifier")) return null;
  const symbol = resolveConstIdentifierAlias(node, context.scopes);
  return symbol?.initializer ? getStaticStringValue(context, symbol.initializer) : null;
};

const isNextHeadersDynamicCall = (
  context: RuleContext,
  expression: EsTreeNode,
  visitedWrapperSymbolIds: Set<number> = new Set(),
): boolean => {
  const node = stripParenExpression(expression);
  if (!isNodeOfType(node, "CallExpression")) return false;
  const callee = stripParenExpression(node.callee);
  if (isNodeOfType(callee, "Identifier")) {
    const symbol = resolveConstIdentifierAlias(callee, context.scopes);
    if (symbol?.kind === "import" && isNodeOfType(symbol.bindingIdentifier, "Identifier")) {
      const importedName = getImportedNameFromModule(
        node,
        symbol.bindingIdentifier.name,
        "next/headers",
      );
      if (importedName !== null && DYNAMIC_API_NAMES.has(importedName)) return true;
    }
    const localSymbol = context.scopes.symbolFor(callee);
    if (localSymbol?.kind === "const" && localSymbol.initializer) {
      const initializer = stripParenExpression(localSymbol.initializer);
      if (isNodeOfType(initializer, "MemberExpression")) {
        const namespaceExpression = stripParenExpression(initializer.object);
        const importedName = getResolvedStaticPropertyName(initializer, context.scopes);
        if (
          isNodeOfType(namespaceExpression, "Identifier") &&
          importedName !== null &&
          DYNAMIC_API_NAMES.has(importedName)
        ) {
          const namespaceSymbol = resolveConstIdentifierAlias(namespaceExpression, context.scopes);
          if (
            namespaceSymbol?.kind === "import" &&
            isNodeOfType(namespaceSymbol.bindingIdentifier, "Identifier") &&
            isNamespaceImportFromModule(
              node,
              namespaceSymbol.bindingIdentifier.name,
              "next/headers",
            )
          ) {
            return true;
          }
        }
      }
    }
    if (
      node.arguments.length === 0 &&
      localSymbol?.initializer &&
      isFunctionLike(localSymbol.initializer) &&
      !visitedWrapperSymbolIds.has(localSymbol.id) &&
      localSymbol.initializer.params.length === 0
    ) {
      const returnedExpression = getSingleReturnExpression(localSymbol.initializer);
      if (returnedExpression) {
        visitedWrapperSymbolIds.add(localSymbol.id);
        if (isNextHeadersDynamicCall(context, returnedExpression, visitedWrapperSymbolIds)) {
          return true;
        }
      }
    }
    if (
      localSymbol?.kind !== "const" ||
      !isNodeOfType(localSymbol.declarationNode, "VariableDeclarator") ||
      !isNodeOfType(localSymbol.declarationNode.id, "ObjectPattern") ||
      !localSymbol.initializer
    ) {
      return false;
    }
    const property = localSymbol.declarationNode.id.properties.find(
      (candidateProperty) =>
        isNodeOfType(candidateProperty, "Property") &&
        candidateProperty.value === localSymbol.bindingIdentifier,
    );
    if (!isNodeOfType(property, "Property")) return false;
    const importedName = getStaticPropertyKeyName(property, { allowComputedString: true });
    const namespaceExpression = stripParenExpression(localSymbol.initializer);
    if (
      importedName === null ||
      !DYNAMIC_API_NAMES.has(importedName) ||
      !isNodeOfType(namespaceExpression, "Identifier")
    ) {
      return false;
    }
    const namespaceSymbol = resolveConstIdentifierAlias(namespaceExpression, context.scopes);
    return Boolean(
      namespaceSymbol?.kind === "import" &&
      isNodeOfType(namespaceSymbol.bindingIdentifier, "Identifier") &&
      isNamespaceImportFromModule(node, namespaceSymbol.bindingIdentifier.name, "next/headers"),
    );
  }
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  const namespaceObject = stripParenExpression(callee.object);
  const memberName = getResolvedStaticPropertyName(callee, context.scopes);
  if (
    !isNodeOfType(namespaceObject, "Identifier") ||
    memberName === null ||
    !DYNAMIC_API_NAMES.has(memberName) ||
    !resolveConstIdentifierAlias(namespaceObject, context.scopes)
  ) {
    return false;
  }
  const namespaceSymbol = resolveConstIdentifierAlias(namespaceObject, context.scopes);
  return Boolean(
    namespaceSymbol?.kind === "import" &&
    isNodeOfType(namespaceSymbol.bindingIdentifier, "Identifier") &&
    isNamespaceImportFromModule(node, namespaceSymbol.bindingIdentifier.name, "next/headers"),
  );
};

const isUnsafeUnwrappedType = (
  context: RuleContext,
  typeNode: EsTreeNode,
  visitedSymbolIds: Set<number> = new Set(),
): boolean => {
  if (!isNodeOfType(typeNode, "TSTypeReference")) return false;
  const typeName = typeNode.typeName;
  if (isNodeOfType(typeName, "Identifier")) {
    const symbol = findVisibleSymbol(typeName, context.scopes);
    if (!symbol || visitedSymbolIds.has(symbol.id)) return false;
    if (symbol.kind === "import") {
      const importedName = getImportedNameFromModule(typeNode, typeName.name, "next/headers");
      return importedName !== null && UNSAFE_UNWRAPPED_TYPE_NAMES.has(importedName);
    }
    if (!isNodeOfType(symbol.declarationNode, "TSTypeAliasDeclaration")) return false;
    visitedSymbolIds.add(symbol.id);
    return isUnsafeUnwrappedType(context, symbol.declarationNode.typeAnnotation, visitedSymbolIds);
  }
  if (
    !isNodeOfType(typeName, "TSQualifiedName") ||
    !isNodeOfType(typeName.left, "Identifier") ||
    !isNodeOfType(typeName.right, "Identifier") ||
    !UNSAFE_UNWRAPPED_TYPE_NAMES.has(typeName.right.name) ||
    !resolvesToImportBinding(context, typeName.left)
  ) {
    return false;
  }
  return isNamespaceImportFromModule(typeNode, typeName.left.name, "next/headers");
};

const castChainAssertsUnsafeUnwrapped = (context: RuleContext, expression: EsTreeNode): boolean => {
  if (hasCapability(context.settings, "nextjs:16")) return false;
  let current: EsTreeNode | null = expression;
  while (current) {
    if (
      (isNodeOfType(current, "TSAsExpression") || isNodeOfType(current, "TSTypeAssertion")) &&
      isUnsafeUnwrappedType(context, current.typeAnnotation)
    ) {
      return true;
    }
    if (
      !TRANSPARENT_EXPRESSION_WRAPPER_TYPES.has(current.type) ||
      !("expression" in current) ||
      !isAstNode(current.expression)
    ) {
      return false;
    }
    current = current.expression;
  }
  return false;
};

const isPromiseSettleAccess = (
  context: RuleContext,
  memberExpression: EsTreeNodeOfType<"MemberExpression">,
): boolean => {
  const propertyName = getResolvedStaticPropertyName(memberExpression, context.scopes);
  return propertyName !== null && PROMISE_SETTLE_METHODS.has(propertyName);
};

interface StaticLogicalValue {
  isNullish: boolean;
  isTruthy: boolean;
}

interface RetainedExpressionFrame {
  expression: EsTreeNode;
  isExpanded: boolean;
}

interface RetainedSourceMatcher {
  (expression: EsTreeNode): EsTreeNode | null;
}

interface PatternAssignedValue {
  expression: EsTreeNode | null;
}

interface FunctionAliasCandidate {
  sourceNode: EsTreeNode;
  symbol: SymbolDescriptor;
}

interface OfficialAsyncPropContract {
  directConsumptionPropertyNames?: ReadonlySet<string>;
  parameterIndex: number;
  propertyNames: ReadonlySet<string>;
}

interface OfficialAsyncPropReference {
  contract: OfficialAsyncPropContract;
  propertyName: string;
}

interface OfficialPropsObjectSource {
  contract: OfficialAsyncPropContract;
  sourceExpression: EsTreeNode;
  symbol: SymbolDescriptor;
}

const getOfficialAsyncPropContract = (
  context: RuleContext,
  functionNode: EsTreeNode,
): OfficialAsyncPropContract | null => {
  const basename = path.basename(context.filename ?? "");
  const normalizedFilename = normalizeFilename(context.filename ?? "");
  const isSitemapFile =
    (isInProjectDirectory(context, "app") || normalizedFilename.startsWith("app/")) &&
    SITEMAP_FILE_PATTERN.test(basename);
  if (!isSitemapFile && !isFrameworkRouteOrSpecialFilename(context, "next")) return null;
  const program = findProgramRoot(functionNode);
  if (!program) return null;
  const routeKind = basename.split(".")[0] ?? "";
  const exportedValueMatchesFunction = (exportedValue: EsTreeNode | null): boolean => {
    if (exportedValue === functionNode) return true;
    if (!exportedValue || !isNodeOfType(exportedValue, "Identifier")) return false;
    const symbol = resolveConstIdentifierAlias(exportedValue, context.scopes);
    return Boolean(
      symbol && (symbol.initializer === functionNode || symbol.declarationNode === functionNode),
    );
  };
  const isDefaultExport = exportedValueMatchesFunction(findExportedValue(program, "default"));
  const isPage = routeKind === "page";
  if (isDefaultExport) {
    if (isPage) {
      return { parameterIndex: 0, propertyNames: new Set(["params", "searchParams"]) };
    }
    if (
      routeKind === "layout" ||
      routeKind === "default" ||
      (isNextjsMetadataImageRouteFilename(context.filename) &&
        hasCapability(context.settings, "nextjs:16"))
    ) {
      return {
        directConsumptionPropertyNames: isNextjsMetadataImageRouteFilename(context.filename)
          ? new Set(["id"])
          : undefined,
        parameterIndex: 0,
        propertyNames: isNextjsMetadataImageRouteFilename(context.filename)
          ? new Set(["id", "params"])
          : new Set(["params"]),
      };
    }
    if (isSitemapFile && hasCapability(context.settings, "nextjs:16")) {
      return {
        directConsumptionPropertyNames: new Set(["id"]),
        parameterIndex: 0,
        propertyNames: new Set(["id"]),
      };
    }
  }
  if (routeKind === "route") {
    for (const methodName of ROUTE_HANDLER_HTTP_METHODS) {
      if (exportedValueMatchesFunction(findExportedValue(program, methodName))) {
        return { parameterIndex: 1, propertyNames: new Set(["params"]) };
      }
    }
    return null;
  }
  if (routeKind !== "page" && routeKind !== "layout") return null;
  if (
    !exportedValueMatchesFunction(findExportedValue(program, "generateMetadata")) &&
    !exportedValueMatchesFunction(findExportedValue(program, "generateViewport"))
  ) {
    return null;
  }
  return {
    parameterIndex: 0,
    propertyNames: isPage ? new Set(["params", "searchParams"]) : new Set(["params"]),
  };
};

const findParameterPropertyName = (
  parameter: EsTreeNode,
  bindingIdentifier: EsTreeNode,
): string | null => {
  const pattern = isNodeOfType(parameter, "AssignmentPattern") ? parameter.left : parameter;
  if (!isNodeOfType(pattern, "ObjectPattern")) return null;
  for (const property of pattern.properties) {
    if (!isNodeOfType(property, "Property")) continue;
    let propertyBinding = property.value;
    if (isNodeOfType(propertyBinding, "AssignmentPattern")) {
      propertyBinding = propertyBinding.left;
    }
    if (propertyBinding !== bindingIdentifier) continue;
    return getStaticPropertyKeyName(property, { allowComputedString: true });
  }
  return null;
};

const findObjectRestElementForSymbol = (
  context: RuleContext,
  pattern: EsTreeNode,
  symbol: SymbolDescriptor,
): EsTreeNode | null => {
  if (!isNodeOfType(pattern, "ObjectPattern")) return null;
  return (
    pattern.properties.find(
      (property) =>
        isNodeOfType(property, "RestElement") &&
        context.scopes.symbolFor(property.argument)?.id === symbol.id,
    ) ?? null
  );
};

const narrowContractForObjectRest = (
  pattern: EsTreeNode,
  contract: OfficialAsyncPropContract,
): OfficialAsyncPropContract | null => {
  if (!isNodeOfType(pattern, "ObjectPattern")) return null;
  const propertyNames = new Set(contract.propertyNames);
  for (const property of pattern.properties) {
    if (!isNodeOfType(property, "Property")) continue;
    const propertyName = getStaticPropertyKeyName(property, { allowComputedString: true });
    if (propertyName === null) return null;
    propertyNames.delete(propertyName);
  }
  const directConsumptionPropertyNames = contract.directConsumptionPropertyNames
    ? new Set(contract.directConsumptionPropertyNames)
    : undefined;
  if (directConsumptionPropertyNames) {
    for (const propertyName of contract.propertyNames) {
      if (!propertyNames.has(propertyName)) directConsumptionPropertyNames.delete(propertyName);
    }
  }
  return { directConsumptionPropertyNames, parameterIndex: contract.parameterIndex, propertyNames };
};

const findOfficialPropsObjectSource = (
  context: RuleContext,
  expression: EsTreeNode,
  visitedSymbolIds: Set<number> = new Set(),
): OfficialPropsObjectSource | null => {
  const node = stripParenExpression(expression);
  if (!isNodeOfType(node, "Identifier")) return null;
  const directSymbol = context.scopes.symbolFor(node);
  if (!directSymbol || visitedSymbolIds.has(directSymbol.id)) return null;
  visitedSymbolIds.add(directSymbol.id);
  const symbol = resolveConstIdentifierAlias(node, context.scopes) ?? directSymbol;
  if (!symbol) return null;
  const functionNode = context.cfg.enclosingFunction(symbol.bindingIdentifier);
  if (functionNode && isFunctionLike(functionNode)) {
    const contract = getOfficialAsyncPropContract(context, functionNode);
    const parameter = contract ? functionNode.params[contract.parameterIndex] : null;
    const parameterPattern =
      parameter && isNodeOfType(parameter, "AssignmentPattern") ? parameter.left : parameter;
    const isDirectParameter = parameterPattern === symbol.bindingIdentifier;
    const restElement =
      contract && parameterPattern
        ? findObjectRestElementForSymbol(context, parameterPattern, symbol)
        : null;
    if (contract && isDirectParameter) {
      return { contract, sourceExpression: symbol.bindingIdentifier, symbol };
    }
    if (contract && parameterPattern && restElement) {
      const narrowedContract = narrowContractForObjectRest(parameterPattern, contract);
      return narrowedContract
        ? { contract: narrowedContract, sourceExpression: restElement, symbol }
        : null;
    }
  }
  if (
    directSymbol.kind === "const" &&
    directSymbol.initializer &&
    isNodeOfType(directSymbol.declarationNode, "VariableDeclarator")
  ) {
    const declarationPattern = directSymbol.declarationNode.id;
    const restElement = findObjectRestElementForSymbol(context, declarationPattern, directSymbol);
    if (restElement) {
      const source = findOfficialPropsObjectSource(
        context,
        directSymbol.initializer,
        new Set(visitedSymbolIds),
      );
      const narrowedContract = source
        ? narrowContractForObjectRest(declarationPattern, source.contract)
        : null;
      return source && narrowedContract
        ? { contract: narrowedContract, sourceExpression: restElement, symbol: directSymbol }
        : null;
    }
  }
  const assignmentCandidates = directSymbol.references
    .map((reference) => findPatternAssignmentForIdentifier(reference.identifier))
    .filter((assignment): assignment is EsTreeNodeOfType<"AssignmentExpression"> =>
      Boolean(
        assignment &&
        assignment.operator === "=" &&
        findObjectRestElementForSymbol(context, assignment.left, directSymbol) &&
        nodeDominatesNode(assignment, expression, context),
      ),
    )
    .sort((left, right) => getNodeStartIndex(right) - getNodeStartIndex(left));
  for (const assignment of assignmentCandidates) {
    const source = findOfficialPropsObjectSource(
      context,
      assignment.right,
      new Set(visitedSymbolIds),
    );
    const narrowedContract = source
      ? narrowContractForObjectRest(assignment.left, source.contract)
      : null;
    if (source && narrowedContract) {
      return { contract: narrowedContract, sourceExpression: assignment, symbol: directSymbol };
    }
  }
  return null;
};

const memberExpressionMatchesOfficialProperty = (
  context: RuleContext,
  expression: EsTreeNode,
  sourceSymbol: SymbolDescriptor,
  propertyName: string,
): boolean => {
  const node = stripParenExpression(expression);
  if (
    !isNodeOfType(node, "MemberExpression") ||
    getResolvedStaticPropertyName(node, context.scopes) !== propertyName
  ) {
    return false;
  }
  const receiver = stripParenExpression(node.object);
  if (!isNodeOfType(receiver, "Identifier")) return false;
  const receiverSymbol =
    resolveConstIdentifierAlias(receiver, context.scopes) ?? context.scopes.symbolFor(receiver);
  return receiverSymbol?.id === sourceSymbol.id;
};

const assignmentUnwrapsOfficialProperty = (
  context: RuleContext,
  assignment: EsTreeNodeOfType<"AssignmentExpression">,
  sourceSymbol: SymbolDescriptor,
  propertyName: string,
): boolean => {
  if (
    assignment.operator !== "=" ||
    !memberExpressionMatchesOfficialProperty(context, assignment.left, sourceSymbol, propertyName)
  ) {
    return false;
  }
  const right = stripParenExpression(assignment.right);
  if (isNodeOfType(right, "AwaitExpression")) {
    return true;
  }
  if (
    isNodeOfType(right, "CallExpression") &&
    isReactApiCall(right, "use", context.scopes, { resolveNamedAliases: true }) &&
    right.arguments[0] &&
    !isNodeOfType(right.arguments[0], "SpreadElement")
  ) {
    return true;
  }
  return !expressionMayRetainOfficialPendingValue(context, right);
};

const collectOfficialPropertyClearingNodes = (
  context: RuleContext,
  source: OfficialPropsObjectSource,
  propertyName: string,
): EsTreeNode[] => {
  const owner = context.cfg.enclosingFunction(source.sourceExpression);
  if (!owner) return [];
  const clearingNodes: EsTreeNode[] = [];
  walkAst(owner, (node) => {
    if (isNodeOfType(node, "AssignmentExpression")) {
      if (
        node.operator === "="
          ? assignmentUnwrapsOfficialProperty(context, node, source.symbol, propertyName)
          : node.operator !== "||=" &&
            node.operator !== "??=" &&
            memberExpressionMatchesOfficialProperty(context, node.left, source.symbol, propertyName)
      ) {
        clearingNodes.push(node);
      }
      return;
    }
    if (
      isNodeOfType(node, "UpdateExpression") &&
      memberExpressionMatchesOfficialProperty(context, node.argument, source.symbol, propertyName)
    ) {
      clearingNodes.push(node);
    }
  });
  return projectGuaranteedClearingNodes(context, clearingNodes, owner);
};

const officialPropertyIsClearedBeforeReferenceInOwner = (
  context: RuleContext,
  source: OfficialPropsObjectSource,
  propertyName: string,
  reference: EsTreeNode,
): boolean => {
  const referenceOwner = context.cfg.enclosingFunction(reference);
  if (
    !referenceOwner ||
    referenceOwner === context.cfg.enclosingFunction(source.sourceExpression)
  ) {
    return false;
  }
  const clearingNodes: EsTreeNode[] = [];
  walkAst(referenceOwner, (node) => {
    if (node !== referenceOwner && isFunctionLike(node)) return false;
    if (
      isNodeOfType(node, "AssignmentExpression") &&
      !findCaughtTryStatement(node) &&
      (node.operator === "="
        ? assignmentUnwrapsOfficialProperty(context, node, source.symbol, propertyName)
        : node.operator !== "||=" &&
          node.operator !== "??=" &&
          memberExpressionMatchesOfficialProperty(context, node.left, source.symbol, propertyName))
    ) {
      clearingNodes.push(node);
    }
  });
  return projectGuaranteedClearingNodes(context, clearingNodes, referenceOwner).some(
    (executionSite) => nodeDominatesNode(executionSite, reference, context),
  );
};

const findOfficialAsyncRequestPropReference = (
  context: RuleContext,
  expression: EsTreeNode,
): OfficialAsyncPropReference | null => {
  const node = stripParenExpression(expression);
  let bindingIdentifier: EsTreeNode | null = null;
  let propertyName: string | null = null;
  if (isNodeOfType(node, "Identifier")) {
    const symbol = context.scopes.symbolFor(node);
    if (!symbol) return null;
    bindingIdentifier = symbol.bindingIdentifier;
  } else if (isNodeOfType(node, "MemberExpression")) {
    const receiver = stripParenExpression(node.object);
    if (!isNodeOfType(receiver, "Identifier")) return null;
    propertyName = getStaticPropertyName(node);
    const propsSource = findOfficialPropsObjectSource(context, receiver);
    if (
      !propsSource ||
      propertyName === null ||
      !propsSource.contract.propertyNames.has(propertyName) ||
      officialPropertyIsClearedBeforeReferenceInOwner(context, propsSource, propertyName, node) ||
      createPendingSymbolFlow(
        context,
        propsSource.symbol,
        propsSource.sourceExpression,
        collectOfficialPropertyClearingNodes(context, propsSource, propertyName),
      ).isClearedBefore(node)
    ) {
      return null;
    }
    return { contract: propsSource.contract, propertyName };
  } else {
    return null;
  }
  const functionNode = context.cfg.enclosingFunction(bindingIdentifier);
  if (!functionNode || !isFunctionLike(functionNode)) return null;
  const bindingSymbol = context.scopes.symbolFor(bindingIdentifier);
  if (!bindingSymbol) return null;
  const contract = getOfficialAsyncPropContract(context, functionNode);
  if (!contract) return null;
  const parameter = functionNode.params[contract.parameterIndex];
  if (!parameter) return null;
  const destructuredPropertyName = findParameterPropertyName(parameter, bindingIdentifier);
  if (
    !destructuredPropertyName ||
    !contract.propertyNames.has(destructuredPropertyName) ||
    createPendingSymbolFlow(context, bindingSymbol, bindingIdentifier).isClearedBefore(node)
  ) {
    return null;
  }
  return { contract, propertyName: destructuredPropertyName };
};

const isOfficialAsyncRequestPropSource = (context: RuleContext, expression: EsTreeNode): boolean =>
  Boolean(findOfficialAsyncRequestPropReference(context, expression));

const isOfficialDirectValueSource = (context: RuleContext, expression: EsTreeNode): boolean => {
  const reference = findOfficialAsyncRequestPropReference(context, expression);
  return Boolean(reference?.contract.directConsumptionPropertyNames?.has(reference.propertyName));
};

const getStaticLogicalValue = (
  context: RuleContext,
  expression: EsTreeNode,
): StaticLogicalValue | null => {
  let node = stripParenExpression(expression);
  let hasBooleanNegation = false;
  let shouldInvertTruthy = false;
  while (isNodeOfType(node, "UnaryExpression") && node.operator === "!") {
    hasBooleanNegation = true;
    shouldInvertTruthy = !shouldInvertTruthy;
    node = stripParenExpression(node.argument);
  }

  let value: StaticLogicalValue | null = null;
  if (isNodeOfType(node, "Literal")) {
    value = { isNullish: node.value === null, isTruthy: Boolean(node.value) };
  } else if (
    isNodeOfType(node, "ArrayExpression") ||
    isNodeOfType(node, "ObjectExpression") ||
    isNodeOfType(node, "ArrowFunctionExpression") ||
    isNodeOfType(node, "FunctionExpression") ||
    isNodeOfType(node, "ClassExpression") ||
    isNodeOfType(node, "NewExpression")
  ) {
    value = { isNullish: false, isTruthy: true };
  } else if (isNodeOfType(node, "TemplateLiteral")) {
    const hasStaticContent = node.quasis.some(
      (quasi) => (quasi.value.cooked ?? quasi.value.raw).length > 0,
    );
    if (hasStaticContent || node.expressions.length === 0) {
      value = { isNullish: false, isTruthy: hasStaticContent };
    }
  } else if (isNodeOfType(node, "UnaryExpression") && node.operator === "void") {
    value = { isNullish: true, isTruthy: false };
  } else if (isNodeOfType(node, "UnaryExpression") && node.operator === "typeof") {
    value = { isNullish: false, isTruthy: true };
  } else if (
    isNodeOfType(node, "Identifier") &&
    context.scopes.isGlobalReference(node) &&
    (node.name === "undefined" || node.name === "NaN" || node.name === "Infinity")
  ) {
    value = {
      isNullish: node.name === "undefined",
      isTruthy: node.name === "Infinity",
    };
  }
  if (!value || !hasBooleanNegation) return value;
  return {
    isNullish: false,
    isTruthy: shouldInvertTruthy ? !value.isTruthy : value.isTruthy,
  };
};

const logicalRightCanBecomeResult = (
  operator: EsTreeNodeOfType<"LogicalExpression">["operator"],
  leftValue: StaticLogicalValue,
): boolean => {
  if (operator === "&&") return leftValue.isTruthy;
  if (operator === "||") return !leftValue.isTruthy;
  return leftValue.isNullish;
};

const expressionIsGuaranteedNullish = (context: RuleContext, expression: EsTreeNode): boolean => {
  const staticValue = getStaticLogicalValue(context, expression);
  if (staticValue) return staticValue.isNullish;
  if (isNodeOfType(expression, "ConditionalExpression")) {
    const testValue = getStaticLogicalValue(context, expression.test);
    return Boolean(
      testValue &&
      expressionIsGuaranteedNullish(
        context,
        testValue.isTruthy ? expression.consequent : expression.alternate,
      ),
    );
  }
  if (isNodeOfType(expression, "LogicalExpression")) {
    const leftValue = getStaticLogicalValue(context, expression.left);
    if (!leftValue) return false;
    return logicalRightCanBecomeResult(expression.operator, leftValue)
      ? expressionIsGuaranteedNullish(context, expression.right)
      : leftValue.isNullish;
  }
  if (isNodeOfType(expression, "SequenceExpression")) {
    const finalExpression = expression.expressions.at(-1);
    return Boolean(finalExpression && expressionIsGuaranteedNullish(context, finalExpression));
  }
  if (isNodeOfType(expression, "AssignmentExpression")) {
    return expressionIsGuaranteedNullish(context, expression.right);
  }
  if (isNodeOfType(expression, "ChainExpression")) {
    return optionalChainStaticallyShortCircuits(context, expression.expression);
  }
  return (
    (isNodeOfType(expression, "MemberExpression") || isNodeOfType(expression, "CallExpression")) &&
    optionalChainStaticallyShortCircuits(context, expression)
  );
};

const optionalChainStaticallyShortCircuits = (
  context: RuleContext,
  expression: EsTreeNode,
): boolean => {
  let current = expression;
  while (true) {
    if (isNodeOfType(current, "MemberExpression")) {
      if (current.optional && expressionIsGuaranteedNullish(context, current.object)) return true;
      current = current.object;
      continue;
    }
    if (isNodeOfType(current, "CallExpression")) {
      if (current.optional && expressionIsGuaranteedNullish(context, current.callee)) return true;
      current = current.callee;
      continue;
    }
    return false;
  }
};

const getStaticSymbolValueBefore = (
  context: RuleContext,
  identifier: EsTreeNode,
  referenceNode: EsTreeNode,
): StaticLogicalValue | null => {
  const symbol = context.scopes.symbolFor(identifier);
  if (!symbol) return null;
  let valueExpression = symbol.initializer;
  let valueStart = valueExpression ? getNodeStartIndex(valueExpression) : -1;
  for (const reference of symbol.references) {
    if (reference.flag === "read") continue;
    const assignment = findPatternAssignmentForIdentifier(reference.identifier);
    if (
      !assignment ||
      assignment.operator !== "=" ||
      context.cfg.enclosingFunction(assignment) !== context.cfg.enclosingFunction(referenceNode) ||
      !nodeDominatesNode(assignment, referenceNode, context)
    ) {
      continue;
    }
    const assignmentStart = getNodeStartIndex(assignment);
    if (assignmentStart <= valueStart || assignmentStart >= getNodeStartIndex(referenceNode)) {
      continue;
    }
    const assignedValue = findPatternAssignedValue(
      context,
      assignment.left,
      assignment.right,
      symbol,
    );
    if (!assignedValue) continue;
    valueExpression = assignedValue.expression;
    valueStart = assignmentStart;
  }
  if (valueExpression) return getStaticLogicalValue(context, valueExpression);
  return isNodeOfType(symbol.declarationNode, "VariableDeclarator")
    ? { isNullish: true, isTruthy: false }
    : null;
};

const expressionIsStaticallySkipped = (
  context: RuleContext,
  expression: EsTreeNode,
  logicalAssignmentReference: EsTreeNode | null = null,
): boolean => {
  let current = expression;
  while (current.parent) {
    const parent = current.parent;
    if (isFunctionLike(parent)) return false;
    if (isNodeOfType(parent, "LogicalExpression") && parent.right === current) {
      const leftValue = getStaticLogicalValue(context, parent.left);
      if (leftValue && !logicalRightCanBecomeResult(parent.operator, leftValue)) return true;
    } else if (isNodeOfType(parent, "ConditionalExpression") && parent.test !== current) {
      const testValue = getStaticLogicalValue(context, parent.test);
      if (
        testValue &&
        ((parent.consequent === current && !testValue.isTruthy) ||
          (parent.alternate === current && testValue.isTruthy))
      ) {
        return true;
      }
    } else if (isNodeOfType(parent, "IfStatement") && parent.test !== current) {
      const testValue = getStaticLogicalValue(context, parent.test);
      if (
        testValue &&
        ((parent.consequent === current && !testValue.isTruthy) ||
          (parent.alternate === current && testValue.isTruthy))
      ) {
        return true;
      }
    } else if (
      isNodeOfType(parent, "WhileStatement") &&
      parent.body === current &&
      getStaticLogicalValue(context, parent.test)?.isTruthy === false
    ) {
      return true;
    } else if (
      isNodeOfType(parent, "ForStatement") &&
      (parent.body === current || parent.update === current) &&
      parent.test &&
      getStaticLogicalValue(context, parent.test)?.isTruthy === false
    ) {
      return true;
    } else if (
      isNodeOfType(parent, "AssignmentExpression") &&
      parent.right === current &&
      (parent.operator === "&&=" || parent.operator === "||=" || parent.operator === "??=")
    ) {
      const target = stripParenExpression(parent.left);
      const leftValue = isNodeOfType(target, "Identifier")
        ? getStaticSymbolValueBefore(context, target, logicalAssignmentReference ?? parent)
        : null;
      if (
        leftValue &&
        ((parent.operator === "&&=" && !leftValue.isTruthy) ||
          (parent.operator === "||=" && leftValue.isTruthy) ||
          (parent.operator === "??=" && !leftValue.isNullish))
      ) {
        return true;
      }
    } else if (
      isNodeOfType(parent, "MemberExpression") &&
      parent.computed &&
      parent.property === current &&
      optionalChainStaticallyShortCircuits(context, parent)
    ) {
      return true;
    } else if (
      isNodeOfType(parent, "CallExpression") &&
      parent.arguments.some((argument) => argument === current) &&
      optionalChainStaticallyShortCircuits(context, parent)
    ) {
      return true;
    }
    current = parent;
  }
  return false;
};

const findRetainedExpressionSource = (
  context: RuleContext,
  expression: EsTreeNode,
  matchSource: RetainedSourceMatcher,
): EsTreeNode | null => {
  const sourceByExpression = new Map<EsTreeNode, EsTreeNode | null>();
  const pendingFrames: RetainedExpressionFrame[] = [{ expression, isExpanded: false }];

  while (pendingFrames.length > 0) {
    const frame = pendingFrames.pop();
    if (!frame) continue;
    if (castChainAssertsUnsafeUnwrapped(context, frame.expression)) {
      sourceByExpression.set(frame.expression, null);
      continue;
    }
    const node = stripParenExpression(frame.expression);
    if (!frame.isExpanded) {
      pendingFrames.push({ expression: frame.expression, isExpanded: true });
      if (isNodeOfType(node, "ConditionalExpression")) {
        const staticTestValue = getStaticLogicalValue(context, node.test);
        if (staticTestValue) {
          pendingFrames.push({
            expression: staticTestValue.isTruthy ? node.consequent : node.alternate,
            isExpanded: false,
          });
        } else {
          pendingFrames.push({ expression: node.consequent, isExpanded: false });
          pendingFrames.push({ expression: node.alternate, isExpanded: false });
        }
      } else if (isNodeOfType(node, "LogicalExpression")) {
        pendingFrames.push({ expression: node.left, isExpanded: false });
        pendingFrames.push({ expression: node.right, isExpanded: false });
      } else if (isNodeOfType(node, "SequenceExpression")) {
        const finalExpression = node.expressions.at(-1);
        if (finalExpression) {
          pendingFrames.push({ expression: finalExpression, isExpanded: false });
        }
      } else if (isNodeOfType(node, "AssignmentExpression")) {
        pendingFrames.push({ expression: node.right, isExpanded: false });
      } else if (isNodeOfType(node, "CallExpression")) {
        const callee = stripParenExpression(node.callee);
        if (isNodeOfType(callee, "MemberExpression") && isPromiseSettleAccess(context, callee)) {
          pendingFrames.push({ expression: callee.object, isExpanded: false });
        }
      }
      continue;
    }

    const directSource = matchSource(node);
    if (directSource) {
      sourceByExpression.set(frame.expression, directSource);
      continue;
    }

    let retainedSource: EsTreeNode | null = null;
    if (isNodeOfType(node, "ConditionalExpression")) {
      const staticTestValue = getStaticLogicalValue(context, node.test);
      if (staticTestValue) {
        retainedSource =
          sourceByExpression.get(staticTestValue.isTruthy ? node.consequent : node.alternate) ??
          null;
      } else {
        retainedSource =
          sourceByExpression.get(node.alternate) ?? sourceByExpression.get(node.consequent) ?? null;
      }
    } else if (isNodeOfType(node, "LogicalExpression")) {
      const leftSource = sourceByExpression.get(node.left) ?? null;
      const rightSource = sourceByExpression.get(node.right) ?? null;
      if (leftSource) {
        retainedSource = node.operator === "&&" ? rightSource : leftSource;
      } else {
        const staticLeftValue = getStaticLogicalValue(context, node.left);
        retainedSource =
          !staticLeftValue || logicalRightCanBecomeResult(node.operator, staticLeftValue)
            ? rightSource
            : null;
      }
    } else if (isNodeOfType(node, "SequenceExpression")) {
      const finalExpression = node.expressions.at(-1);
      retainedSource = finalExpression ? (sourceByExpression.get(finalExpression) ?? null) : null;
    } else if (isNodeOfType(node, "AssignmentExpression")) {
      retainedSource = sourceByExpression.get(node.right) ?? null;
    } else if (isNodeOfType(node, "CallExpression")) {
      const callee = stripParenExpression(node.callee);
      if (isNodeOfType(callee, "MemberExpression") && isPromiseSettleAccess(context, callee)) {
        retainedSource = sourceByExpression.get(callee.object) ?? null;
      }
    }
    sourceByExpression.set(frame.expression, retainedSource);
  }
  return sourceByExpression.get(expression) ?? null;
};

const expressionMayRetainOfficialPendingValue = (
  context: RuleContext,
  expression: EsTreeNode,
): boolean => {
  const activeSymbolReferences = new Set<string>();
  const findSource = (candidate: EsTreeNode): EsTreeNode | null =>
    findRetainedExpressionSource(context, candidate, (nestedCandidate) => {
      if (isNextHeadersDynamicCall(context, nestedCandidate)) return nestedCandidate;
      if (isNodeOfType(nestedCandidate, "MemberExpression")) {
        const receiver = stripParenExpression(nestedCandidate.object);
        const propertyName = getResolvedStaticPropertyName(nestedCandidate, context.scopes);
        const propsSource = isNodeOfType(receiver, "Identifier")
          ? findOfficialPropsObjectSource(context, receiver)
          : null;
        return propsSource && propertyName && propsSource.contract.propertyNames.has(propertyName)
          ? nestedCandidate
          : null;
      }
      if (!isNodeOfType(nestedCandidate, "Identifier")) return null;
      if (findOfficialAsyncRequestPropReference(context, nestedCandidate)) return nestedCandidate;
      const symbol = context.scopes.symbolFor(nestedCandidate);
      if (symbol && isNodeOfType(symbol.declarationNode, "VariableDeclarator")) {
        const declaration = symbol.declarationNode;
        const propertyName = findParameterPropertyName(declaration.id, symbol.bindingIdentifier);
        const propsSource = declaration.init
          ? findOfficialPropsObjectSource(context, declaration.init)
          : null;
        if (
          propertyName &&
          propsSource?.contract.propertyNames.has(propertyName) &&
          !createPendingSymbolFlow(context, symbol, symbol.bindingIdentifier).isClearedBefore(
            nestedCandidate,
          )
        ) {
          return nestedCandidate;
        }
      }
      if (!symbol) return null;
      const candidateStart = getNodeStartIndex(nestedCandidate);
      const activeReferenceKey = `${symbol.id}:${candidateStart}`;
      if (activeSymbolReferences.has(activeReferenceKey)) return null;
      activeSymbolReferences.add(activeReferenceKey);
      const candidateSources: EsTreeNode[] = symbol.initializer ? [symbol.initializer] : [];
      for (const reference of symbol.references) {
        if (reference.flag === "read") continue;
        const assignment = findPatternAssignmentForIdentifier(reference.identifier);
        if (
          !assignment ||
          (assignment.operator !== "=" &&
            assignment.operator !== "&&=" &&
            assignment.operator !== "||=" &&
            assignment.operator !== "??=")
        ) {
          continue;
        }
        const assignedValue = findPatternAssignedValue(
          context,
          assignment.left,
          assignment.right,
          symbol,
        );
        if (assignedValue?.expression) candidateSources.push(assignedValue.expression);
      }
      const candidateOwner = context.cfg.enclosingFunction(nestedCandidate);
      for (const sourceExpression of candidateSources) {
        if (
          context.cfg.enclosingFunction(sourceExpression) === candidateOwner &&
          expressionIsStaticallySkipped(context, sourceExpression)
        ) {
          continue;
        }
        const source = findSource(sourceExpression);
        if (!source) continue;
        const sourceOwner = context.cfg.enclosingFunction(sourceExpression);
        const sourceMayEscapeWithPending = Boolean(
          sourceOwner &&
          isFunctionLike(sourceOwner) &&
          sourceOwnerMayEscapeWithPending(context, symbol, sourceExpression),
        );
        const liveCaughtInvocations =
          sourceOwner && isFunctionLike(sourceOwner)
            ? getDirectInvocationSites(context, sourceOwner).filter(
                (invocationSite) =>
                  isNodeReachableWithinFunction(invocationSite, context) &&
                  !expressionIsStaticallySkipped(context, invocationSite) &&
                  caughtInvocationMayContinue(invocationSite),
              )
            : [];
        const allCaughtInvocationsClear =
          liveCaughtInvocations.length > 0 &&
          liveCaughtInvocations.every((invocationSite) =>
            caughtHandlerDefinitelyClearsSymbol(context, symbol, invocationSite),
          );
        const hasCaughtInvocation =
          liveCaughtInvocations.length > 0 &&
          sourceMayEscapeWithPending &&
          !allCaughtInvocationsClear;
        const sourceFlow = createPendingSymbolFlow(context, symbol, sourceExpression);
        if (
          sourceOwner !== candidateOwner &&
          !hasCaughtInvocation &&
          (sourceFlow.isClearedAtExit ||
            (liveCaughtInvocations.length > 0 &&
              (!sourceMayEscapeWithPending || allCaughtInvocationsClear)))
        ) {
          continue;
        }
        const sourceExecutionSites = getRetainedSourceExecutionSites(
          context,
          symbol,
          sourceExpression,
          candidateOwner,
        );
        for (const sourceExecutionSite of sourceExecutionSites) {
          const sourceExecutionStart = getNodeStartIndex(sourceExecutionSite);
          if (
            sourceExecutionStart >= candidateStart ||
            !isNodeReachableWithinFunction(sourceExecutionSite, context) ||
            expressionIsStaticallySkipped(context, sourceExecutionSite) ||
            expressionIsStaticallySkipped(context, sourceExpression, sourceExecutionSite)
          ) {
            continue;
          }
          const clearingExecutionSites = getProjectedProvenanceClearingSites({
            afterStart: sourceExecutionStart,
            context,
            symbol,
            targetOwner: candidateOwner,
          });
          if (
            !createPendingSymbolFlow(
              context,
              symbol,
              sourceExecutionSite,
              clearingExecutionSites,
            ).isClearedBefore(nestedCandidate)
          ) {
            activeSymbolReferences.delete(activeReferenceKey);
            return source;
          }
        }
      }
      activeSymbolReferences.delete(activeReferenceKey);
      return null;
    });
  return Boolean(findSource(expression));
};

const symbolMayHoldOfficialPendingValueBefore = (
  context: RuleContext,
  symbol: SymbolDescriptor,
  reference: EsTreeNode,
): boolean => {
  const referenceOwner = context.cfg.enclosingFunction(reference);
  const referenceStart = getNodeStartIndex(reference);
  const candidateSources: EsTreeNode[] = symbol.initializer ? [symbol.initializer] : [];
  for (const symbolReference of symbol.references) {
    if (symbolReference.flag === "read") continue;
    const assignment = findPatternAssignmentForIdentifier(symbolReference.identifier);
    if (!assignment || assignment.operator !== "=") continue;
    const assignedValue = findPatternAssignedValue(
      context,
      assignment.left,
      assignment.right,
      symbol,
    );
    if (assignedValue?.expression) candidateSources.push(assignedValue.expression);
  }
  return candidateSources.some(
    (sourceExpression) =>
      context.cfg.enclosingFunction(sourceExpression) === referenceOwner &&
      getNodeStartIndex(sourceExpression) < referenceStart &&
      !expressionIsStaticallySkipped(context, sourceExpression) &&
      expressionMayRetainOfficialPendingValue(context, sourceExpression) &&
      !createPendingSymbolFlow(context, symbol, sourceExpression).isClearedBefore(reference),
  );
};

const capturedSymbolMayBePendingAtInvocation = (
  context: RuleContext,
  identifier: EsTreeNode,
): boolean => {
  const symbol = context.scopes.symbolFor(identifier);
  const referenceOwner = context.cfg.enclosingFunction(identifier);
  if (
    !symbol ||
    !referenceOwner ||
    !isFunctionLike(referenceOwner) ||
    context.cfg.enclosingFunction(symbol.bindingIdentifier) === referenceOwner
  ) {
    return false;
  }
  return getDirectInvocationSites(context, referenceOwner, {
    includeCallbackExecutionSites: false,
  }).some((invocationSite) =>
    symbolMayHoldOfficialPendingValueBefore(context, symbol, invocationSite),
  );
};

const findPendingDynamicApiSource = (
  context: RuleContext,
  expression: EsTreeNode,
): EsTreeNode | null =>
  findRetainedExpressionSource(context, expression, (candidateExpression) =>
    isNextHeadersDynamicCall(context, candidateExpression) ||
    isOfficialAsyncRequestPropSource(context, candidateExpression)
      ? candidateExpression
      : null,
  );

const patternReadsDynamicApiValue = (pattern: EsTreeNode): boolean => {
  if (isNodeOfType(pattern, "ArrayPattern")) return true;
  if (!isNodeOfType(pattern, "ObjectPattern")) return false;
  return pattern.properties.some(
    (property) =>
      isNodeOfType(property, "RestElement") ||
      (isNodeOfType(property, "Property") &&
        !PROMISE_SETTLE_METHODS.has(
          getStaticPropertyKeyName(property, { allowComputedString: true }) ?? "",
        )),
  );
};

const isObjectDestructureOfExpression = (parent: EsTreeNode, expression: EsTreeNode): boolean => {
  if (
    isNodeOfType(parent, "VariableDeclarator") &&
    parent.init === expression &&
    (isNodeOfType(parent.id, "ObjectPattern") || isNodeOfType(parent.id, "ArrayPattern"))
  ) {
    return patternReadsDynamicApiValue(parent.id);
  }
  return (
    isNodeOfType(parent, "AssignmentExpression") &&
    parent.right === expression &&
    (isNodeOfType(parent.left, "ObjectPattern") || isNodeOfType(parent.left, "ArrayPattern")) &&
    patternReadsDynamicApiValue(parent.left)
  );
};

const expressionMayRetainPendingSymbol = (
  context: RuleContext,
  expression: EsTreeNode,
  symbol: SymbolDescriptor,
): boolean =>
  Boolean(
    findRetainedExpressionSource(context, expression, (candidateExpression) =>
      isNodeOfType(candidateExpression, "Identifier") &&
      context.scopes.symbolFor(candidateExpression)?.id === symbol.id
        ? candidateExpression
        : null,
    ),
  );

const isGlobalEnumerationCallForArgument = (
  context: RuleContext,
  callExpression: EsTreeNodeOfType<"CallExpression">,
  argumentExpression: EsTreeNode,
): boolean => {
  const callee = stripParenExpression(callExpression.callee);
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  const receiver = stripParenExpression(callee.object);
  if (!isNodeOfType(receiver, "Identifier") || !context.scopes.isGlobalReference(receiver)) {
    return false;
  }
  const methodName = getStaticPropertyName(callee);
  const reflectedPropertyName = callExpression.arguments[1]
    ? getStaticStringValue(context, callExpression.arguments[1])
    : null;
  const accessesPromiseSettleProperty = Boolean(
    reflectedPropertyName && PROMISE_SETTLE_METHODS.has(reflectedPropertyName),
  );
  if (receiver.name === "Array") {
    return methodName === "from" && callExpression.arguments[0] === argumentExpression;
  }
  if (receiver.name === "Reflect") {
    if (
      accessesPromiseSettleProperty &&
      (methodName === "get" || methodName === "getOwnPropertyDescriptor" || methodName === "has")
    ) {
      return false;
    }
    return (
      (methodName === "get" ||
        methodName === "getOwnPropertyDescriptor" ||
        methodName === "has" ||
        methodName === "ownKeys") &&
      callExpression.arguments[0] === argumentExpression
    );
  }
  if (
    receiver.name === "Object" &&
    methodName === "getOwnPropertyDescriptor" &&
    accessesPromiseSettleProperty
  ) {
    return false;
  }
  return (
    receiver.name === "Object" &&
    methodName !== null &&
    ((OBJECT_ENUMERATION_METHOD_NAMES.has(methodName) &&
      callExpression.arguments[0] === argumentExpression) ||
      (methodName === "fromEntries" && callExpression.arguments[0] === argumentExpression) ||
      (methodName === "assign" &&
        callExpression.arguments.slice(1).some((argument) => argument === argumentExpression)))
  );
};

const isGlobalIterableConstructorForArgument = (
  context: RuleContext,
  newExpression: EsTreeNodeOfType<"NewExpression">,
  argumentExpression: EsTreeNode,
): boolean => {
  const callee = stripParenExpression(newExpression.callee);
  return (
    isNodeOfType(callee, "Identifier") &&
    ITERABLE_CONSTRUCTOR_NAMES.has(callee.name) &&
    context.scopes.isGlobalReference(callee) &&
    newExpression.arguments[0] === argumentExpression
  );
};

const isGlobalCoercionCallForArgument = (
  context: RuleContext,
  callExpression: EsTreeNodeOfType<"CallExpression">,
  argumentExpression: EsTreeNode,
): boolean => {
  const callee = stripParenExpression(callExpression.callee);
  if (
    isNodeOfType(callee, "Identifier") &&
    COERCIVE_GLOBAL_NAMES.has(callee.name) &&
    context.scopes.isGlobalReference(callee) &&
    callExpression.arguments[0] === argumentExpression
  ) {
    return true;
  }
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  const receiver = stripParenExpression(callee.object);
  return Boolean(
    isNodeOfType(receiver, "Identifier") &&
    receiver.name === "JSON" &&
    context.scopes.isGlobalReference(receiver) &&
    getResolvedStaticPropertyName(callee, context.scopes) === "stringify" &&
    callExpression.arguments[0] === argumentExpression,
  );
};

const isPromiseSettlementCall = (
  context: RuleContext,
  callExpression: EsTreeNodeOfType<"CallExpression">,
  calleeRoot: EsTreeNode,
  memberExpression: EsTreeNodeOfType<"MemberExpression">,
): boolean =>
  callExpression.callee === calleeRoot && isPromiseSettleAccess(context, memberExpression);

const expressionIsSynchronouslyConsumed = (
  context: RuleContext,
  expression: EsTreeNode,
): boolean => {
  let current = findTransparentExpressionRoot(expression);
  while (current.parent) {
    const parent = current.parent;
    if (isNodeOfType(parent, "MemberExpression") && parent.object === current) {
      if (!isPromiseSettleAccess(context, parent)) return true;
      const memberRoot = findTransparentExpressionRoot(parent);
      const call = memberRoot.parent;
      if (
        !call ||
        !isNodeOfType(call, "CallExpression") ||
        !isPromiseSettlementCall(context, call, memberRoot, parent)
      ) {
        return false;
      }
      current = findTransparentExpressionRoot(call);
      continue;
    }
    if (isNodeOfType(parent, "SpreadElement") && parent.argument === current) return true;
    if (
      (isNodeOfType(parent, "ForOfStatement") || isNodeOfType(parent, "ForInStatement")) &&
      parent.right === current
    ) {
      return true;
    }
    if (isNodeOfType(parent, "YieldExpression") && parent.delegate && parent.argument === current) {
      return true;
    }
    if (
      isNodeOfType(parent, "BinaryExpression") &&
      (parent.operator !== "in" || parent.right === current)
    ) {
      return true;
    }
    if (
      isNodeOfType(parent, "UnaryExpression") &&
      parent.argument === current &&
      !NON_CONSUMING_UNARY_OPERATORS.has(parent.operator)
    ) {
      return true;
    }
    if (
      isNodeOfType(parent, "TemplateLiteral") &&
      parent.expressions.some((expression) => expression === current)
    ) {
      if (
        parent.parent &&
        isNodeOfType(parent.parent, "TaggedTemplateExpression") &&
        parent.parent.quasi === parent
      ) {
        return false;
      }
      return true;
    }
    if (isNodeOfType(parent, "JSXExpressionContainer") && parent.expression === current) {
      return true;
    }
    if (isObjectDestructureOfExpression(parent, current)) return true;
    if (isNodeOfType(parent, "CallExpression")) {
      return (
        isGlobalEnumerationCallForArgument(context, parent, current) ||
        isGlobalCoercionCallForArgument(context, parent, current)
      );
    }
    if (isNodeOfType(parent, "NewExpression")) {
      return isGlobalIterableConstructorForArgument(context, parent, current);
    }
    if (isNodeOfType(parent, "ConditionalExpression")) {
      if (parent.test === current) return false;
      current = findTransparentExpressionRoot(parent);
      continue;
    }
    if (isNodeOfType(parent, "LogicalExpression")) {
      current = findTransparentExpressionRoot(parent);
      continue;
    }
    if (
      (isNodeOfType(parent, "MemberExpression") &&
        parent.computed &&
        parent.property === current) ||
      (isNodeOfType(parent, "Property") && parent.computed && parent.key === current) ||
      (isNodeOfType(parent, "UpdateExpression") && parent.argument === current) ||
      (isNodeOfType(parent, "AssignmentExpression") &&
        parent.operator !== "=" &&
        parent.left === current)
    ) {
      return true;
    }
    if (isNodeOfType(parent, "SequenceExpression")) {
      if (parent.expressions.at(-1) !== current) return false;
      current = findTransparentExpressionRoot(parent);
      continue;
    }
    if (isNodeOfType(parent, "AssignmentExpression") && parent.right === current) {
      current = findTransparentExpressionRoot(parent);
      continue;
    }
    return false;
  }
  return false;
};

const findRetainingAliasCandidate = (
  context: RuleContext,
  referenceIdentifier: EsTreeNode,
  sourceSymbol: SymbolDescriptor,
): PendingSymbolCandidate | null => {
  let current = findTransparentExpressionRoot(referenceIdentifier);
  while (current.parent) {
    const parent = current.parent;
    if (
      isNodeOfType(parent, "VariableDeclarator") &&
      parent.init === current &&
      isNodeOfType(parent.id, "Identifier")
    ) {
      if (!expressionMayRetainPendingSymbol(context, parent.init, sourceSymbol)) return null;
      const symbol = context.scopes.symbolFor(parent.id);
      return symbol ? { sourceExpression: parent.init, symbol } : null;
    }
    if (
      isNodeOfType(parent, "AssignmentExpression") &&
      parent.operator === "=" &&
      parent.right === current &&
      isNodeOfType(stripParenExpression(parent.left), "Identifier")
    ) {
      if (!expressionMayRetainPendingSymbol(context, parent.right, sourceSymbol)) return null;
      const symbol = context.scopes.symbolFor(stripParenExpression(parent.left));
      return symbol ? { sourceExpression: parent.right, symbol } : null;
    }
    if (
      parent.type.endsWith("Statement") ||
      isNodeOfType(parent, "AwaitExpression") ||
      isNodeOfType(parent, "ArrowFunctionExpression") ||
      isNodeOfType(parent, "FunctionExpression")
    ) {
      return null;
    }
    current = findTransparentExpressionRoot(parent);
  }
  return null;
};

const isDefinitelyUndefinedExpression = (context: RuleContext, expression: EsTreeNode): boolean => {
  const node = stripParenExpression(expression);
  return (
    (isNodeOfType(node, "Identifier") &&
      node.name === "undefined" &&
      context.scopes.isGlobalReference(node)) ||
    (isNodeOfType(node, "UnaryExpression") && node.operator === "void")
  );
};

const findPatternAssignedValue = (
  context: RuleContext,
  pattern: EsTreeNode,
  sourceExpression: EsTreeNode | null,
  targetSymbol: SymbolDescriptor,
): PatternAssignedValue | null => {
  if (isNodeOfType(pattern, "Identifier")) {
    return context.scopes.symbolFor(pattern)?.id === targetSymbol.id
      ? { expression: sourceExpression }
      : null;
  }
  if (isNodeOfType(pattern, "AssignmentPattern")) {
    const assignedExpression =
      sourceExpression === null || isDefinitelyUndefinedExpression(context, sourceExpression)
        ? pattern.right
        : sourceExpression;
    return findPatternAssignedValue(context, pattern.left, assignedExpression, targetSymbol);
  }
  if (isNodeOfType(pattern, "ObjectPattern")) {
    if (sourceExpression === null) return null;
    const source = stripParenExpression(sourceExpression);
    if (!isNodeOfType(source, "ObjectExpression")) return null;
    const hasUnknownSourceProperties = source.properties.some(
      (property) =>
        isNodeOfType(property, "SpreadElement") ||
        (isNodeOfType(property, "Property") &&
          getStaticPropertyKeyName(property, { allowComputedString: true }) === null),
    );
    for (const patternProperty of pattern.properties) {
      if (!isNodeOfType(patternProperty, "Property")) continue;
      const propertyName = getStaticPropertyKeyName(patternProperty, { allowComputedString: true });
      if (propertyName === null) continue;
      const sourceProperty = source.properties.find(
        (property) =>
          isNodeOfType(property, "Property") &&
          getStaticPropertyKeyName(property, { allowComputedString: true }) === propertyName,
      );
      if (!isNodeOfType(sourceProperty, "Property") && hasUnknownSourceProperties) continue;
      const assignedValue = findPatternAssignedValue(
        context,
        patternProperty.value,
        isNodeOfType(sourceProperty, "Property") ? sourceProperty.value : null,
        targetSymbol,
      );
      if (assignedValue) return assignedValue;
    }
    return null;
  }
  if (isNodeOfType(pattern, "ArrayPattern")) {
    if (sourceExpression === null) return null;
    const source = stripParenExpression(sourceExpression);
    if (!isNodeOfType(source, "ArrayExpression")) return null;
    for (const [elementIndex, patternElement] of pattern.elements.entries()) {
      const sourceElement = source.elements[elementIndex];
      if (!patternElement) continue;
      if (
        source.elements
          .slice(0, elementIndex + 1)
          .some((element) => isNodeOfType(element, "SpreadElement"))
      )
        continue;
      const assignedValue = findPatternAssignedValue(
        context,
        patternElement,
        sourceElement && !isNodeOfType(sourceElement, "SpreadElement") ? sourceElement : null,
        targetSymbol,
      );
      if (assignedValue) return assignedValue;
    }
  }
  return null;
};

const findPatternAssignmentForIdentifier = (
  identifier: EsTreeNode,
): EsTreeNodeOfType<"AssignmentExpression"> | null => {
  let assignmentTarget = findTransparentExpressionRoot(identifier);
  while (
    assignmentTarget.parent &&
    (isNodeOfType(assignmentTarget.parent, "Property") ||
      isNodeOfType(assignmentTarget.parent, "ObjectPattern") ||
      isNodeOfType(assignmentTarget.parent, "ArrayPattern") ||
      isNodeOfType(assignmentTarget.parent, "AssignmentPattern") ||
      isNodeOfType(assignmentTarget.parent, "RestElement"))
  ) {
    assignmentTarget = assignmentTarget.parent;
  }
  const assignment = assignmentTarget.parent;
  return assignment &&
    isNodeOfType(assignment, "AssignmentExpression") &&
    assignment.left === assignmentTarget
    ? assignment
    : null;
};

const getProvenanceClearingAssignment = (
  context: RuleContext,
  symbol: SymbolDescriptor,
  writeIdentifier: EsTreeNode,
): EsTreeNodeOfType<"AssignmentExpression"> | null => {
  const assignment = findPatternAssignmentForIdentifier(writeIdentifier);
  if (
    !assignment ||
    assignment.operator === "||=" ||
    assignment.operator === "??=" ||
    expressionIsStaticallySkipped(context, assignment)
  ) {
    return null;
  }
  if (assignment.operator !== "=" && assignment.operator !== "&&=") return assignment;
  const assignedValue = findPatternAssignedValue(
    context,
    assignment.left,
    assignment.right,
    symbol,
  );
  if (
    !assignedValue ||
    (assignedValue.expression &&
      expressionMayRetainPendingSymbol(context, assignedValue.expression, symbol))
  ) {
    return null;
  }
  return assignment;
};

const isConditionallyExecutedWithinExpression = (node: EsTreeNode): boolean => {
  let current = node;
  while (current.parent) {
    const parent = current.parent;
    if (isNodeOfType(parent, "LogicalExpression") && parent.right === current) return true;
    if (isNodeOfType(parent, "ConditionalExpression") && parent.test !== current) return true;
    if (
      isNodeOfType(parent, "AssignmentExpression") &&
      (parent.operator === "&&=" || parent.operator === "||=" || parent.operator === "??=") &&
      parent.right === current
    ) {
      return true;
    }
    if (
      isNodeOfType(parent, "CallExpression") &&
      parent.optional &&
      parent.arguments.some((argument) => argument === current)
    ) {
      return true;
    }
    if (
      isNodeOfType(parent, "MemberExpression") &&
      parent.optional &&
      parent.computed &&
      parent.property === current
    ) {
      return true;
    }
    if (parent.type.endsWith("Statement") || isNodeOfType(parent, "VariableDeclarator")) {
      return false;
    }
    current = parent;
  }
  return false;
};

const findDirectConditionalBranch = (
  assignment: EsTreeNode,
): { conditionalExpression: EsTreeNode; isConsequent: boolean } | null => {
  const assignmentRoot = findTransparentExpressionRoot(assignment);
  const parent = assignmentRoot.parent;
  if (!parent || !isNodeOfType(parent, "ConditionalExpression")) return null;
  if (parent.consequent === assignmentRoot) {
    return { conditionalExpression: parent, isConsequent: true };
  }
  return parent.alternate === assignmentRoot
    ? { conditionalExpression: parent, isConsequent: false }
    : null;
};

const findCaughtTryStatement = (node: EsTreeNode): EsTreeNode | null => {
  let current = node;
  while (current.parent) {
    const parent = current.parent;
    if (isNodeOfType(parent, "TryStatement") && parent.block === current && parent.handler) {
      return parent;
    }
    if (
      isNodeOfType(parent, "ArrowFunctionExpression") ||
      isNodeOfType(parent, "FunctionExpression") ||
      isNodeOfType(parent, "FunctionDeclaration")
    ) {
      return null;
    }
    current = parent;
  }
  return null;
};

const aliasIsOverwrittenBeforeInvocation = (
  context: RuleContext,
  candidate: FunctionAliasCandidate,
  invocation: EsTreeNode,
): boolean => {
  const sourceStart = getNodeStartIndex(candidate.sourceNode);
  const invocationStart = getNodeStartIndex(invocation);
  const invocationOwner = context.cfg.enclosingFunction(invocation);
  return candidate.symbol.references.some((reference) => {
    if (reference.flag === "read") return false;
    const patternAssignment = findPatternAssignmentForIdentifier(reference.identifier);
    const referenceRoot = findTransparentExpressionRoot(reference.identifier);
    const directAssignment = referenceRoot.parent;
    let writeNode = reference.identifier;
    if (patternAssignment) {
      writeNode = patternAssignment;
    } else if (
      directAssignment &&
      isNodeOfType(directAssignment, "AssignmentExpression") &&
      directAssignment.left === referenceRoot
    ) {
      writeNode = directAssignment;
    }
    const writeStart = getNodeStartIndex(writeNode);
    return (
      writeNode !== candidate.sourceNode &&
      writeStart > sourceStart &&
      writeStart < invocationStart &&
      context.cfg.enclosingFunction(writeNode) === invocationOwner &&
      nodeDominatesNode(writeNode, invocation, context)
    );
  });
};

const edgeKey = (from: BasicBlock, to: BasicBlock): string => `${from.id}:${to.id}`;

const createPendingSymbolFlow = (
  context: RuleContext,
  symbol: SymbolDescriptor,
  sourceExpression: EsTreeNode,
  additionalClearingNodes: ReadonlyArray<EsTreeNode> = [],
): PendingSymbolFlow => {
  const owner = context.cfg.enclosingFunction(sourceExpression);
  const sourceStart = getNodeStartIndex(sourceExpression);
  if (sourceStart < 0) return { isClearedAtExit: false, isClearedBefore: () => false };

  const projectedClearingNodes = new Set<EsTreeNode>(
    additionalClearingNodes.filter(
      (clearingNode) =>
        isNodeOfType(clearingNode, "CallExpression") || isNodeOfType(clearingNode, "NewExpression"),
    ),
  );
  const clearingAssignmentSet = new Set<EsTreeNode>(additionalClearingNodes);
  for (const reference of symbol.references) {
    if (context.cfg.enclosingFunction(reference.identifier) !== owner) continue;
    const assignment = getProvenanceClearingAssignment(context, symbol, reference.identifier);
    if (!assignment) continue;
    const assignmentStart = getNodeStartIndex(assignment);
    if (assignmentStart <= sourceStart) continue;
    clearingAssignmentSet.add(assignment);
  }
  const clearingNodes = new Set<EsTreeNode>();
  const conditionalClearingBranches = new Map<EsTreeNode, ConditionalClearingBranches>();
  for (const assignment of clearingAssignmentSet) {
    if (!isConditionallyExecutedWithinExpression(assignment)) {
      clearingNodes.add(assignment);
      continue;
    }
    const conditionalBranch = findDirectConditionalBranch(assignment);
    if (!conditionalBranch) continue;
    const branches = conditionalClearingBranches.get(conditionalBranch.conditionalExpression) ?? {
      hasAlternate: false,
      hasConsequent: false,
    };
    if (conditionalBranch.isConsequent) branches.hasConsequent = true;
    else branches.hasAlternate = true;
    conditionalClearingBranches.set(conditionalBranch.conditionalExpression, branches);
  }
  for (const [conditionalExpression, branches] of conditionalClearingBranches) {
    if (branches.hasConsequent && branches.hasAlternate) clearingNodes.add(conditionalExpression);
  }
  if (clearingNodes.size === 0) {
    return { isClearedAtExit: false, isClearedBefore: () => false };
  }

  if (!owner) {
    const unconditionalAssignmentStarts: number[] = [];
    for (const clearingNode of clearingNodes) {
      if (context.cfg.isUnconditionalFromEntry(clearingNode)) {
        unconditionalAssignmentStarts.push(getNodeStartIndex(clearingNode));
      }
    }
    return {
      isClearedAtExit: false,
      isClearedBefore: (referenceIdentifier) => {
        const referenceStart = getNodeStartIndex(referenceIdentifier);
        return unconditionalAssignmentStarts.some((start) => start < referenceStart);
      },
    };
  }
  const functionCfg = context.cfg.cfgFor(owner);
  const isParameterSource =
    isFunctionLike(owner) &&
    owner.params.some(
      (parameter) => parameter === sourceExpression || isAstDescendant(sourceExpression, parameter),
    );
  const sourceBlock =
    functionCfg?.blockOf(sourceExpression) ?? (isParameterSource ? functionCfg?.entry : null);
  if (!functionCfg || !sourceBlock) {
    return { isClearedAtExit: false, isClearedBefore: () => false };
  }

  const clearingStartsByBlock = new Map<BasicBlock, number[]>();
  const exceptionalCatchEdgeKeys = new Set<string>();
  const exitingCatchClearings: ExitingCatchClearing[] = [];
  for (const clearingNode of clearingNodes) {
    const clearingBlock = functionCfg.blockOf(clearingNode);
    if (!clearingBlock) continue;
    const starts = clearingStartsByBlock.get(clearingBlock) ?? [];
    starts.push(getNodeStartIndex(clearingNode));
    clearingStartsByBlock.set(clearingBlock, starts);

    const caughtTryStatement = findCaughtTryStatement(clearingNode);
    if (
      projectedClearingNodes.has(clearingNode) ||
      !caughtTryStatement ||
      !isNodeOfType(caughtTryStatement, "TryStatement")
    ) {
      continue;
    }
    const catchBlock = functionCfg.blockOf(caughtTryStatement.handler?.body ?? caughtTryStatement);
    if (catchBlock) {
      for (const predecessor of catchBlock.predecessors) {
        if (predecessor.kind === "cond") {
          exceptionalCatchEdgeKeys.add(edgeKey(predecessor.from, predecessor.to));
        }
      }
    }
    if (caughtTryStatement.handler && statementAlwaysExits(caughtTryStatement.handler.body)) {
      exitingCatchClearings.push({ clearingNode, tryStatement: caughtTryStatement });
    }
  }

  const reachableBlocks = new Set<BasicBlock>([sourceBlock]);
  const pendingBlocks = [sourceBlock];
  while (pendingBlocks.length > 0) {
    const block = pendingBlocks.pop();
    if (!block) continue;
    for (const successor of block.successors) {
      if (reachableBlocks.has(successor.to)) continue;
      reachableBlocks.add(successor.to);
      pendingBlocks.push(successor.to);
    }
  }

  const incomingClearedByBlock = new Map<BasicBlock, boolean>();
  const outgoingClearedByBlock = new Map<BasicBlock, boolean>();
  for (const block of reachableBlocks) {
    incomingClearedByBlock.set(block, true);
    outgoingClearedByBlock.set(block, true);
  }
  const sourceHasClearingWrite = (clearingStartsByBlock.get(sourceBlock) ?? []).some(
    (start) => start > sourceStart,
  );
  incomingClearedByBlock.set(sourceBlock, false);
  outgoingClearedByBlock.set(sourceBlock, sourceHasClearingWrite);

  const pendingFlowBlocks = sourceBlock.successors.map((successor) => successor.to);
  const queuedFlowBlocks = new Set(pendingFlowBlocks);
  for (let flowBlockIndex = 0; flowBlockIndex < pendingFlowBlocks.length; flowBlockIndex += 1) {
    const block = pendingFlowBlocks[flowBlockIndex];
    if (!block) continue;
    queuedFlowBlocks.delete(block);
    if (block === sourceBlock) continue;
    const reachablePredecessors = block.predecessors.filter((predecessor) =>
      reachableBlocks.has(predecessor.from),
    );
    const isClearedOnEntry =
      reachablePredecessors.length > 0 &&
      reachablePredecessors.every((predecessor) => {
        if (exceptionalCatchEdgeKeys.has(edgeKey(predecessor.from, predecessor.to))) {
          return Boolean(incomingClearedByBlock.get(predecessor.from));
        }
        return Boolean(outgoingClearedByBlock.get(predecessor.from));
      });
    const isClearedOnExit = isClearedOnEntry || (clearingStartsByBlock.get(block)?.length ?? 0) > 0;
    if (
      incomingClearedByBlock.get(block) === isClearedOnEntry &&
      outgoingClearedByBlock.get(block) === isClearedOnExit
    ) {
      continue;
    }
    incomingClearedByBlock.set(block, isClearedOnEntry);
    outgoingClearedByBlock.set(block, isClearedOnExit);
    for (const successor of block.successors) {
      if (!reachableBlocks.has(successor.to) || queuedFlowBlocks.has(successor.to)) continue;
      queuedFlowBlocks.add(successor.to);
      pendingFlowBlocks.push(successor.to);
    }
  }

  const normalExitPredecessors = functionCfg.exit.predecessors.filter(
    (predecessor) => predecessor.kind !== "throw",
  );
  return {
    isClearedAtExit:
      normalExitPredecessors.length > 0 &&
      normalExitPredecessors.every((predecessor) =>
        Boolean(outgoingClearedByBlock.get(predecessor.from)),
      ),
    isClearedBefore: (referenceIdentifier) => {
      if (context.cfg.enclosingFunction(referenceIdentifier) !== owner) return false;
      const referenceStart = getNodeStartIndex(referenceIdentifier);
      const referenceBlock = functionCfg.blockOf(referenceIdentifier);
      if (referenceStart <= sourceStart || !referenceBlock) return false;
      if (
        exitingCatchClearings.some(
          ({ clearingNode, tryStatement }) =>
            getNodeStartIndex(clearingNode) < referenceStart &&
            !isAstDescendant(referenceIdentifier, tryStatement) &&
            context.cfg.isUnconditionalFromEntry(clearingNode),
        )
      ) {
        return true;
      }
      const enclosingClearingStart = Array.from(clearingNodes)
        .filter((clearingNode) => isAstDescendant(referenceIdentifier, clearingNode))
        .map(getNodeStartIndex)
        .at(-1);
      const startsInReferenceBlock = clearingStartsByBlock.get(referenceBlock) ?? [];
      const hasClearingWriteBeforeReference = startsInReferenceBlock.some(
        (start) =>
          start !== enclosingClearingStart &&
          start < referenceStart &&
          (referenceBlock !== sourceBlock || start > sourceStart),
      );
      if (hasClearingWriteBeforeReference) return true;
      if (referenceBlock === sourceBlock) return false;
      return Boolean(incomingClearedByBlock.get(referenceBlock));
    },
  };
};

const getDirectInvocationSites = (
  context: RuleContext,
  functionNode: EsTreeNode,
  options: DirectInvocationSiteOptions = { includeCallbackExecutionSites: true },
): EsTreeNode[] => {
  const expressionIsGuaranteedUndefined = (expression: EsTreeNode): boolean => {
    const node = stripParenExpression(expression);
    return (
      (isNodeOfType(node, "UnaryExpression") && node.operator === "void") ||
      (isNodeOfType(node, "Identifier") &&
        node.name === "undefined" &&
        context.scopes.isGlobalReference(node))
    );
  };
  const applyKnownCardinalityMutations = (
    symbol: SymbolDescriptor,
    initialCardinality: KnownArrayCardinality,
    referenceNode: EsTreeNode,
  ): KnownArrayCardinality | null => {
    const referenceStart = getNodeStartIndex(referenceNode);
    const referenceOwner = context.cfg.enclosingFunction(referenceNode);
    const cardinality = { ...initialCardinality };
    const mutationReferences = symbol.references
      .filter(
        (reference) =>
          getNodeStartIndex(reference.identifier) < referenceStart &&
          context.cfg.enclosingFunction(reference.identifier) === referenceOwner &&
          isNodeReachableWithinFunction(reference.identifier, context) &&
          !expressionIsStaticallySkipped(context, reference.identifier),
      )
      .toSorted(
        (first, second) =>
          getNodeStartIndex(first.identifier) - getNodeStartIndex(second.identifier),
      );
    for (const reference of mutationReferences) {
      const referenceRoot = findTransparentExpressionRoot(reference.identifier);
      const memberExpression = referenceRoot.parent;
      if (
        !memberExpression ||
        !isNodeOfType(memberExpression, "MemberExpression") ||
        memberExpression.object !== referenceRoot
      ) {
        continue;
      }
      const parent = memberExpression.parent;
      if (parent && isNodeOfType(parent, "CallExpression") && parent.callee === memberExpression) {
        const methodName = getResolvedStaticPropertyName(memberExpression, context.scopes);
        if (!methodName || !MUTATING_ARRAY_METHODS.has(methodName)) continue;
        if (methodName === "push" || methodName === "unshift") {
          if (parent.arguments.some((argument) => isNodeOfType(argument, "SpreadElement"))) {
            return null;
          }
          cardinality.length += parent.arguments.length;
          cardinality.presentElementCount += parent.arguments.length;
          cardinality.comparableElementCount += parent.arguments.filter(
            (argument) => !expressionIsGuaranteedUndefined(argument),
          ).length;
          continue;
        }
        if (methodName === "pop" || methodName === "shift") {
          if (cardinality.length === 0) continue;
          if (
            cardinality.presentElementCount !== cardinality.length ||
            cardinality.comparableElementCount !== cardinality.presentElementCount
          ) {
            return null;
          }
          cardinality.length -= 1;
          cardinality.presentElementCount -= 1;
          cardinality.comparableElementCount -= 1;
          continue;
        }
        return null;
      }
      if (
        !parent ||
        !isNodeOfType(parent, "AssignmentExpression") ||
        parent.left !== memberExpression ||
        parent.operator !== "="
      ) {
        continue;
      }
      const propertyName = getResolvedStaticPropertyName(memberExpression, context.scopes);
      if (propertyName === "length" && isNodeOfType(parent.right, "Literal")) {
        const nextLength = parent.right.value;
        if (typeof nextLength !== "number" || !Number.isInteger(nextLength) || nextLength < 0) {
          return null;
        }
        if (nextLength >= cardinality.length) {
          cardinality.length = nextLength;
          continue;
        }
        if (
          nextLength === 0 ||
          (cardinality.presentElementCount === cardinality.length &&
            cardinality.comparableElementCount === cardinality.presentElementCount)
        ) {
          cardinality.length = nextLength;
          cardinality.presentElementCount = nextLength;
          cardinality.comparableElementCount = nextLength;
          continue;
        }
        return null;
      }
      const property = stripParenExpression(memberExpression.property);
      if (
        memberExpression.computed &&
        isNodeOfType(property, "Literal") &&
        typeof property.value === "number" &&
        Number.isInteger(property.value) &&
        property.value >= cardinality.length
      ) {
        cardinality.length = property.value + 1;
        cardinality.presentElementCount += 1;
        if (!expressionIsGuaranteedUndefined(parent.right)) {
          cardinality.comparableElementCount += 1;
        }
        continue;
      }
      return null;
    }
    return cardinality;
  };
  const getKnownArrayCardinality = (
    expression: EsTreeNode,
    referenceNode: EsTreeNode,
    visitedSymbolIds: ReadonlySet<number> = new Set(),
  ): KnownArrayCardinality | null => {
    const node = stripParenExpression(expression);
    if (isNodeOfType(node, "Identifier")) {
      const symbol = resolveConstIdentifierAlias(node, context.scopes);
      if (!symbol?.initializer || visitedSymbolIds.has(symbol.id)) {
        return null;
      }
      const nextVisitedSymbolIds = new Set(visitedSymbolIds);
      nextVisitedSymbolIds.add(symbol.id);
      const initialCardinality = getKnownArrayCardinality(
        symbol.initializer,
        referenceNode,
        nextVisitedSymbolIds,
      );
      return initialCardinality
        ? applyKnownCardinalityMutations(symbol, initialCardinality, referenceNode)
        : null;
    }
    if (isNodeOfType(node, "Literal") && typeof node.value === "string") {
      const codePointCount = Array.from(node.value).length;
      return {
        comparableElementCount: codePointCount,
        length: codePointCount,
        presentElementCount: codePointCount,
      };
    }
    if (isNodeOfType(node, "ArrayExpression")) {
      const cardinality: KnownArrayCardinality = {
        comparableElementCount: 0,
        length: 0,
        presentElementCount: 0,
      };
      for (const element of node.elements) {
        if (!element) {
          cardinality.length += 1;
          continue;
        }
        if (isNodeOfType(element, "SpreadElement")) {
          const spreadCardinality = getKnownArrayCardinality(
            element.argument,
            referenceNode,
            visitedSymbolIds,
          );
          if (!spreadCardinality) return null;
          cardinality.length += spreadCardinality.length;
          cardinality.presentElementCount += spreadCardinality.length;
          cardinality.comparableElementCount += spreadCardinality.comparableElementCount;
          continue;
        }
        cardinality.length += 1;
        cardinality.presentElementCount += 1;
        if (!expressionIsGuaranteedUndefined(element)) cardinality.comparableElementCount += 1;
      }
      return cardinality;
    }
    if (!isNodeOfType(node, "CallExpression") && !isNodeOfType(node, "NewExpression")) {
      return null;
    }
    const callee = stripParenExpression(node.callee);
    if (
      isNodeOfType(callee, "Identifier") &&
      callee.name === "Array" &&
      context.scopes.isGlobalReference(callee)
    ) {
      const argumentsList = node.arguments ?? [];
      const onlyArgument = argumentsList.length === 1 ? argumentsList[0] : null;
      if (
        onlyArgument &&
        !isNodeOfType(onlyArgument, "SpreadElement") &&
        isNodeOfType(onlyArgument, "Literal") &&
        typeof onlyArgument.value === "number" &&
        Number.isInteger(onlyArgument.value) &&
        onlyArgument.value >= 0
      ) {
        return {
          comparableElementCount: 0,
          length: onlyArgument.value,
          presentElementCount: 0,
        };
      }
      if (argumentsList.some((argument) => isNodeOfType(argument, "SpreadElement"))) return null;
      const comparableElementCount = argumentsList.filter(
        (argument) => !expressionIsGuaranteedUndefined(argument),
      ).length;
      return {
        comparableElementCount,
        length: argumentsList.length,
        presentElementCount: argumentsList.length,
      };
    }
    if (
      !isNodeOfType(callee, "MemberExpression") ||
      !isNodeOfType(callee.object, "Identifier") ||
      callee.object.name !== "Array" ||
      !context.scopes.isGlobalReference(callee.object)
    ) {
      return null;
    }
    const methodName = getResolvedStaticPropertyName(callee, context.scopes);
    if (methodName === "from") {
      const sourceArgument = node.arguments?.[0];
      if (!sourceArgument || isNodeOfType(sourceArgument, "SpreadElement")) return null;
      const sourceCardinality = getKnownArrayCardinality(
        sourceArgument,
        referenceNode,
        visitedSymbolIds,
      );
      return sourceCardinality
        ? {
            comparableElementCount: sourceCardinality.comparableElementCount,
            length: sourceCardinality.length,
            presentElementCount: sourceCardinality.length,
          }
        : null;
    }
    if (methodName !== "of") return null;
    const argumentsList = node.arguments ?? [];
    if (argumentsList.some((argument) => isNodeOfType(argument, "SpreadElement"))) return null;
    return {
      comparableElementCount: argumentsList.filter(
        (argument) => !expressionIsGuaranteedUndefined(argument),
      ).length,
      length: argumentsList.length,
      presentElementCount: argumentsList.length,
    };
  };
  const callbackExecutionMatches = (invocationSite: EsTreeNode): boolean => {
    if (isNodeOfType(invocationSite, "NewExpression")) return true;
    if (!isNodeOfType(invocationSite, "CallExpression")) return false;
    const callee = stripParenExpression(invocationSite.callee);
    if (!isNodeOfType(callee, "MemberExpression")) {
      return !options.requireGuaranteedCallbackExecution;
    }
    const methodName = getResolvedStaticPropertyName(callee, context.scopes);
    if (
      methodName === "from" &&
      isNodeOfType(callee.object, "Identifier") &&
      callee.object.name === "Array" &&
      context.scopes.isGlobalReference(callee.object)
    ) {
      const sourceArgument = invocationSite.arguments[0];
      const sourceCardinality =
        sourceArgument && !isNodeOfType(sourceArgument, "SpreadElement")
          ? getKnownArrayCardinality(sourceArgument, invocationSite)
          : null;
      return sourceCardinality
        ? sourceCardinality.length > 0
        : !options.requireGuaranteedCallbackExecution;
    }
    const receiver = stripParenExpression(callee.object);
    const cardinality = getKnownArrayCardinality(receiver, invocationSite);
    if (cardinality) {
      if (methodName === "reduce" || methodName === "reduceRight") {
        return invocationSite.arguments.slice(1).length > 0
          ? cardinality.presentElementCount > 0
          : cardinality.presentElementCount > 1;
      }
      if (methodName === "sort" || methodName === "toSorted") {
        return cardinality.comparableElementCount > 1;
      }
      return cardinality.presentElementCount > 0;
    }
    return !options.requireGuaranteedCallbackExecution;
  };
  const functionRoot = findTransparentExpressionRoot(functionNode);
  const directParent = functionRoot.parent;
  if (
    directParent &&
    isNodeOfType(directParent, "CallExpression") &&
    directParent.callee === functionRoot
  ) {
    return [directParent];
  }
  if (
    options.includeCallbackExecutionSites &&
    directParent &&
    callbackExecutionMatches(directParent) &&
    executesDuringRender(functionRoot, context.scopes, {
      requireProvenSynchronousCallbackReceiver: true,
    })
  ) {
    return [directParent];
  }

  let functionSymbol: SymbolDescriptor | null = null;
  if (isNodeOfType(functionNode, "FunctionDeclaration") && functionNode.id) {
    functionSymbol = context.scopes.symbolFor(functionNode.id);
  } else {
    const declarationParent = functionRoot.parent;
    if (
      declarationParent &&
      isNodeOfType(declarationParent, "VariableDeclarator") &&
      declarationParent.init === functionRoot &&
      isNodeOfType(declarationParent.id, "Identifier")
    ) {
      functionSymbol = context.scopes.symbolFor(declarationParent.id);
    }
  }
  if (!functionSymbol) return [];

  const invocationSites: EsTreeNode[] = [];
  const pendingFunctionAliases: FunctionAliasCandidate[] = [
    { sourceNode: functionNode, symbol: functionSymbol },
  ];
  const visitedFunctionSymbolIds = new Set<number>();
  while (pendingFunctionAliases.length > 0) {
    const candidate = pendingFunctionAliases.pop();
    if (!candidate || visitedFunctionSymbolIds.has(candidate.symbol.id)) continue;
    visitedFunctionSymbolIds.add(candidate.symbol.id);
    for (const reference of candidate.symbol.references) {
      if (reference.flag === "write") continue;
      const referenceRoot = findTransparentExpressionRoot(reference.identifier);
      const parent = referenceRoot.parent;
      if (parent && isNodeOfType(parent, "CallExpression") && parent.callee === referenceRoot) {
        if (!aliasIsOverwrittenBeforeInvocation(context, candidate, parent)) {
          invocationSites.push(parent);
        }
        continue;
      }
      if (
        options.includeCallbackExecutionSites &&
        parent &&
        callbackExecutionMatches(parent) &&
        (isNodeOfType(parent, "CallExpression") || isNodeOfType(parent, "NewExpression")) &&
        executesDuringRender(referenceRoot, context.scopes, {
          requireProvenSynchronousCallbackReceiver: true,
        })
      ) {
        if (!aliasIsOverwrittenBeforeInvocation(context, candidate, parent)) {
          invocationSites.push(parent);
        }
        continue;
      }
      if (
        parent &&
        isNodeOfType(parent, "VariableDeclarator") &&
        parent.init === referenceRoot &&
        isNodeOfType(parent.id, "Identifier")
      ) {
        const aliasSymbol = context.scopes.symbolFor(parent.id);
        if (aliasSymbol) pendingFunctionAliases.push({ sourceNode: parent, symbol: aliasSymbol });
        continue;
      }
      if (
        parent &&
        isNodeOfType(parent, "AssignmentExpression") &&
        parent.operator === "=" &&
        parent.right === referenceRoot
      ) {
        const assignmentTarget = stripParenExpression(parent.left);
        if (!isNodeOfType(assignmentTarget, "Identifier")) continue;
        const aliasSymbol = context.scopes.symbolFor(assignmentTarget);
        if (aliasSymbol) pendingFunctionAliases.push({ sourceNode: parent, symbol: aliasSymbol });
      }
    }
  }
  return invocationSites;
};

const invocationWaitsForCompletion = (invocationSite: EsTreeNode): boolean => {
  const invocationRoot = findTransparentExpressionRoot(invocationSite);
  const parent = invocationRoot.parent;
  return Boolean(
    parent && isNodeOfType(parent, "AwaitExpression") && parent.argument === invocationRoot,
  );
};

const getStaticallySelectedExecutionRoot = (context: RuleContext, node: EsTreeNode): EsTreeNode => {
  let current = node;
  let selectedRoot = node;
  while (current.parent && !isFunctionLike(current.parent)) {
    const parent = current.parent;
    if (isNodeOfType(parent, "IfStatement") && parent.test !== current) {
      const testValue = getStaticLogicalValue(context, parent.test);
      const isSelectedBranch = Boolean(
        testValue &&
        ((parent.consequent === current && testValue.isTruthy) ||
          (parent.alternate === current && !testValue.isTruthy)),
      );
      if (!isSelectedBranch) break;
      selectedRoot = parent;
    }
    current = parent;
  }
  return selectedRoot;
};

const getAsyncExecutionPhase = (context: RuleContext, node: EsTreeNode): AsyncExecutionPhase => {
  const owner = context.cfg.enclosingFunction(node);
  if (!owner || !isFunctionLike(owner) || !owner.async) {
    return { mayExecuteBeforeSuspension: true, mustExecuteBeforeSuspension: true };
  }
  const nodeStart = getNodeStartIndex(node);
  let hasPossiblePriorSuspension = false;
  let hasGuaranteedPriorSuspension = false;
  walkAst(owner, (candidate) => {
    if (candidate !== owner && isFunctionLike(candidate)) return false;
    if (!isNodeOfType(candidate, "AwaitExpression")) return;
    if (
      !isNodeReachableWithinFunction(candidate, context) ||
      expressionIsStaticallySkipped(context, candidate)
    ) {
      return;
    }
    const isInsideEffect = isAstDescendant(candidate, node);
    if (!isInsideEffect && getNodeStartIndex(candidate) >= nodeStart) return;
    hasPossiblePriorSuspension = true;
    if (
      isInsideEffect ||
      nodeDominatesNode(getStaticallySelectedExecutionRoot(context, candidate), node, context)
    ) {
      hasGuaranteedPriorSuspension = true;
    }
  });
  return {
    mayExecuteBeforeSuspension: !hasGuaranteedPriorSuspension,
    mustExecuteBeforeSuspension: !hasPossiblePriorSuspension,
  };
};

const caughtInvocationMayContinue = (invocationSite: EsTreeNode): boolean => {
  const caughtTryStatement = findCaughtTryStatement(invocationSite);
  return Boolean(
    caughtTryStatement &&
    isNodeOfType(caughtTryStatement, "TryStatement") &&
    caughtTryStatement.handler &&
    !statementAlwaysExits(caughtTryStatement.handler.body),
  );
};

const caughtHandlerDefinitelyClearsSymbol = (
  context: RuleContext,
  symbol: SymbolDescriptor,
  invocationSite: EsTreeNode,
): boolean => {
  const caughtTryStatement = findCaughtTryStatement(invocationSite);
  if (
    !caughtTryStatement ||
    !isNodeOfType(caughtTryStatement, "TryStatement") ||
    !caughtTryStatement.handler
  ) {
    return false;
  }
  const handlerBody = caughtTryStatement.handler.body;
  const clearingAssignments = symbol.references.flatMap((reference) => {
    if (reference.flag === "read") return [];
    const assignment = getProvenanceClearingAssignment(context, symbol, reference.identifier);
    return assignment && isAstDescendant(assignment, handlerBody) ? [assignment] : [];
  });
  const handlerOwner = context.cfg.enclosingFunction(handlerBody);
  return projectGuaranteedClearingNodes(context, clearingAssignments, handlerOwner).some(
    (clearingNode) => {
      let current = findTransparentExpressionRoot(clearingNode);
      while (current.parent && current.parent !== handlerBody) {
        const parent = current.parent;
        if (
          isNodeOfType(parent, "IfStatement") ||
          isNodeOfType(parent, "ConditionalExpression") ||
          isNodeOfType(parent, "SwitchStatement") ||
          isNodeOfType(parent, "WhileStatement") ||
          isNodeOfType(parent, "DoWhileStatement") ||
          isNodeOfType(parent, "ForStatement") ||
          isNodeOfType(parent, "ForInStatement") ||
          isNodeOfType(parent, "ForOfStatement")
        ) {
          return false;
        }
        current = parent;
      }
      return current.parent === handlerBody;
    },
  );
};

const throwEscapesBeforeNode = (throwNode: EsTreeNode, node: EsTreeNode): boolean => {
  let current = throwNode;
  while (current.parent && !isFunctionLike(current.parent)) {
    const parent = current.parent;
    if (isNodeOfType(parent, "TryStatement")) {
      if (parent.finalizer && isAstDescendant(node, parent.finalizer)) return false;
      if (parent.block === current && parent.handler) return false;
    }
    current = parent;
  }
  return true;
};

const hasEscapingThrowBeforeNode = (context: RuleContext, node: EsTreeNode): boolean => {
  const owner = context.cfg.enclosingFunction(node);
  if (!owner) return false;
  const nodeStart = getNodeStartIndex(node);
  let hasPriorThrow = false;
  walkAst(owner, (candidate) => {
    if (candidate !== owner && isFunctionLike(candidate)) return false;
    if (
      isNodeOfType(candidate, "ThrowStatement") &&
      getNodeStartIndex(candidate) < nodeStart &&
      isNodeReachableWithinFunction(candidate, context) &&
      !expressionIsStaticallySkipped(context, candidate) &&
      throwEscapesBeforeNode(candidate, node)
    ) {
      hasPriorThrow = true;
    }
  });
  return hasPriorThrow;
};

const callIsKnownNoop = (context: RuleContext, node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  const callee = stripParenExpression(node.callee);
  if (!isNodeOfType(callee, "Identifier")) return false;
  const symbol = context.scopes.symbolFor(callee);
  const functionNode = symbol?.initializer ?? symbol?.declarationNode;
  return Boolean(
    functionNode &&
    isFunctionLike(functionNode) &&
    isNodeOfType(functionNode.body, "BlockStatement") &&
    functionNode.body.body.length === 0,
  );
};

const hasEscapingCallBeforeNode = (context: RuleContext, node: EsTreeNode): boolean => {
  const owner = context.cfg.enclosingFunction(node);
  if (!owner) return false;
  const nodeStart = getNodeStartIndex(node);
  let hasPriorCall = false;
  walkAst(owner, (candidate) => {
    if (candidate !== owner && isFunctionLike(candidate)) return false;
    if (
      (isNodeOfType(candidate, "CallExpression") || isNodeOfType(candidate, "NewExpression")) &&
      getNodeStartIndex(candidate) < nodeStart &&
      isNodeReachableWithinFunction(candidate, context) &&
      !expressionIsStaticallySkipped(context, candidate) &&
      !findCaughtTryStatement(candidate) &&
      !isNextHeadersDynamicCall(context, candidate) &&
      !callIsKnownNoop(context, candidate) &&
      throwEscapesBeforeNode(candidate, node)
    ) {
      hasPriorCall = true;
    }
  });
  return hasPriorCall;
};

const sourceOwnerMayEscapeWithPending = (
  context: RuleContext,
  symbol: SymbolDescriptor,
  sourceExpression: EsTreeNode,
): boolean => {
  const owner = context.cfg.enclosingFunction(sourceExpression);
  if (!owner) return false;
  const sourceStart = getNodeStartIndex(sourceExpression);
  const flow = createPendingSymbolFlow(context, symbol, sourceExpression);
  let mayEscapeWithPending = false;
  walkAst(owner, (candidate) => {
    if (candidate !== owner && isFunctionLike(candidate)) return false;
    if (
      isNodeOfType(candidate, "ThrowStatement") &&
      getNodeStartIndex(candidate) > sourceStart &&
      isNodeReachableWithinFunction(candidate, context) &&
      !expressionIsStaticallySkipped(context, candidate) &&
      throwEscapesBeforeNode(candidate, owner) &&
      !flow.isClearedBefore(candidate)
    ) {
      mayEscapeWithPending = true;
    }
    if (
      (isNodeOfType(candidate, "CallExpression") || isNodeOfType(candidate, "NewExpression")) &&
      getNodeStartIndex(candidate) > sourceStart &&
      isNodeReachableWithinFunction(candidate, context) &&
      !expressionIsStaticallySkipped(context, candidate) &&
      !findCaughtTryStatement(candidate) &&
      !isNextHeadersDynamicCall(context, candidate) &&
      !callIsKnownNoop(context, candidate) &&
      throwEscapesBeforeNode(candidate, owner) &&
      !flow.isClearedBefore(candidate)
    ) {
      mayEscapeWithPending = true;
    }
  });
  return mayEscapeWithPending;
};

const getExecutionSitesInOwner = (
  context: RuleContext,
  node: EsTreeNode,
  targetOwner: EsTreeNode | null,
  options: ExecutionProjectionOptions,
  visitedFunctionNodes: ReadonlySet<EsTreeNode> = new Set(),
): EsTreeNode[] => {
  const nodeOwner = context.cfg.enclosingFunction(node);
  if (nodeOwner === targetOwner) return [node];
  if (
    !nodeOwner ||
    !isFunctionLike(nodeOwner) ||
    visitedFunctionNodes.has(nodeOwner) ||
    !isNodeReachableWithinFunction(node, context) ||
    (options.requiresGuaranteedExecution && !context.cfg.isUnconditionalFromEntry(node))
  ) {
    return [];
  }
  const nextVisitedFunctionNodes = new Set(visitedFunctionNodes);
  nextVisitedFunctionNodes.add(nodeOwner);
  const executionPhase = getAsyncExecutionPhase(context, node);
  const hasPriorEscapingInterruption =
    options.requiresGuaranteedExecution &&
    (hasEscapingThrowBeforeNode(context, node) || hasEscapingCallBeforeNode(context, node));
  return getDirectInvocationSites(context, nodeOwner, {
    includeCallbackExecutionSites: true,
    requireGuaranteedCallbackExecution: options.requiresGuaranteedExecution,
  }).flatMap((invocationSite) => {
    if (hasPriorEscapingInterruption && caughtInvocationMayContinue(invocationSite)) return [];
    if (
      !invocationWaitsForCompletion(invocationSite) &&
      (options.requiresGuaranteedExecution
        ? !executionPhase.mustExecuteBeforeSuspension
        : !executionPhase.mayExecuteBeforeSuspension)
    ) {
      return [];
    }
    return getExecutionSitesInOwner(
      context,
      invocationSite,
      targetOwner,
      options,
      nextVisitedFunctionNodes,
    );
  });
};

const findConditionalClearingBranch = (
  node: EsTreeNode,
): { conditionalRoot: EsTreeNode; isConsequent: boolean } | null => {
  let current = findTransparentExpressionRoot(node);
  while (current.parent && !isFunctionLike(current.parent)) {
    const parent = current.parent;
    if (isNodeOfType(parent, "IfStatement")) {
      if (parent.consequent === current) {
        return { conditionalRoot: parent, isConsequent: true };
      }
      if (parent.alternate === current) {
        return { conditionalRoot: parent, isConsequent: false };
      }
      return null;
    }
    if (isNodeOfType(parent, "ConditionalExpression")) {
      if (parent.consequent === current) {
        return { conditionalRoot: parent, isConsequent: true };
      }
      if (parent.alternate === current) {
        return { conditionalRoot: parent, isConsequent: false };
      }
      return null;
    }
    if (!isNodeOfType(parent, "ExpressionStatement") && !isNodeOfType(parent, "BlockStatement")) {
      return null;
    }
    current = parent;
  }
  return null;
};

const projectGuaranteedClearingNodes = (
  context: RuleContext,
  clearingNodes: ReadonlyArray<EsTreeNode>,
  targetOwner: EsTreeNode | null,
): EsTreeNode[] => {
  const reachableClearingNodes = clearingNodes.filter(
    (clearingNode) =>
      isNodeReachableWithinFunction(clearingNode, context) &&
      !expressionIsStaticallySkipped(context, clearingNode),
  );
  const combinedClearingNodes = [...reachableClearingNodes];
  const combinedClearingNodeSet = new Set(combinedClearingNodes);
  let didCombineBranch = true;
  while (didCombineBranch) {
    didCombineBranch = false;
    const conditionalBranches = new Map<
      EsTreeNode,
      { hasAlternate: boolean; hasConsequent: boolean }
    >();
    for (const clearingNode of combinedClearingNodes) {
      const branch = findConditionalClearingBranch(clearingNode);
      if (!branch) continue;
      const branches = conditionalBranches.get(branch.conditionalRoot) ?? {
        hasAlternate: false,
        hasConsequent: false,
      };
      if (branch.isConsequent) branches.hasConsequent = true;
      else branches.hasAlternate = true;
      conditionalBranches.set(branch.conditionalRoot, branches);
    }
    for (const [conditionalRoot, branches] of conditionalBranches) {
      if (
        !branches.hasConsequent ||
        !branches.hasAlternate ||
        combinedClearingNodeSet.has(conditionalRoot)
      ) {
        continue;
      }
      combinedClearingNodeSet.add(conditionalRoot);
      combinedClearingNodes.push(conditionalRoot);
      didCombineBranch = true;
    }
  }
  return combinedClearingNodes.flatMap((clearingNode) =>
    getExecutionSitesInOwner(context, clearingNode, targetOwner, {
      requiresGuaranteedExecution: true,
    }),
  );
};

const getProjectedProvenanceClearingSites = ({
  afterStart,
  context,
  symbol,
  targetOwner,
}: ProjectedClearingSitesInput): EsTreeNode[] => {
  const clearingAssignments = symbol.references.flatMap((reference) => {
    const assignment = getProvenanceClearingAssignment(context, symbol, reference.identifier);
    return assignment ? [assignment] : [];
  });
  return projectGuaranteedClearingNodes(context, clearingAssignments, targetOwner).filter(
    (clearingExecutionSite) => getNodeStartIndex(clearingExecutionSite) > afterStart,
  );
};

const getRetainedSourceExecutionSites = (
  context: RuleContext,
  symbol: SymbolDescriptor,
  node: EsTreeNode,
  targetOwner: EsTreeNode | null,
  visitedFunctionNodes: ReadonlySet<EsTreeNode> = new Set(),
): EsTreeNode[] => {
  const nodeOwner = context.cfg.enclosingFunction(node);
  if (nodeOwner === targetOwner) return [node];
  if (
    !nodeOwner ||
    !isFunctionLike(nodeOwner) ||
    visitedFunctionNodes.has(nodeOwner) ||
    !isNodeReachableWithinFunction(node, context)
  ) {
    return [];
  }
  const nextVisitedFunctionNodes = new Set(visitedFunctionNodes);
  nextVisitedFunctionNodes.add(nodeOwner);
  const executionPhase = getAsyncExecutionPhase(context, node);
  return getDirectInvocationSites(context, nodeOwner, {
    includeCallbackExecutionSites: true,
    requireGuaranteedCallbackExecution: false,
  }).flatMap((invocationSite) => {
    if (
      !invocationWaitsForCompletion(invocationSite) &&
      !executionPhase.mayExecuteBeforeSuspension
    ) {
      return [];
    }
    const invocationOwner = context.cfg.enclosingFunction(invocationSite);
    if (!invocationOwner) return [];
    if (invocationOwner !== targetOwner) {
      const invocationStart = getNodeStartIndex(invocationSite);
      const clearingExecutionSites = getProjectedProvenanceClearingSites({
        afterStart: invocationStart,
        context,
        symbol,
        targetOwner: invocationOwner,
      });
      if (
        createPendingSymbolFlow(context, symbol, invocationSite, clearingExecutionSites)
          .isClearedAtExit
      ) {
        return [];
      }
    }
    return getRetainedSourceExecutionSites(
      context,
      symbol,
      invocationSite,
      targetOwner,
      nextVisitedFunctionNodes,
    );
  });
};

const symbolHasSynchronousAccess = (
  context: RuleContext,
  initialSymbol: SymbolDescriptor,
  initialSourceExpression: EsTreeNode,
): boolean => {
  const pendingCandidates: PendingSymbolCandidate[] = [
    { sourceExpression: initialSourceExpression, symbol: initialSymbol },
  ];
  const visitedSymbolIds = new Set<number>();

  while (pendingCandidates.length > 0) {
    const candidate = pendingCandidates.pop();
    if (!candidate || visitedSymbolIds.has(candidate.symbol.id)) continue;
    visitedSymbolIds.add(candidate.symbol.id);
    const owner = context.cfg.enclosingFunction(candidate.sourceExpression);
    const hasAnyWrite = candidate.symbol.references.some(
      (reference) =>
        reference.flag !== "read" ||
        Boolean(findPatternAssignmentForIdentifier(reference.identifier)),
    );
    const sourceStart = getNodeStartIndex(candidate.sourceExpression);
    const projectedClearingSites = getProjectedProvenanceClearingSites({
      afterStart: sourceStart,
      context,
      symbol: candidate.symbol,
      targetOwner: owner,
    });
    const flow = createPendingSymbolFlow(
      context,
      candidate.symbol,
      candidate.sourceExpression,
      projectedClearingSites,
    );

    for (const reference of candidate.symbol.references) {
      if (reference.flag === "write" || findPatternAssignmentForIdentifier(reference.identifier)) {
        continue;
      }
      const referenceStart = getNodeStartIndex(reference.identifier);
      if (referenceStart <= sourceStart) continue;
      const referenceOwner = context.cfg.enclosingFunction(reference.identifier);
      if (referenceOwner !== owner && hasAnyWrite) {
        if (!referenceOwner) continue;
        const hasWriteInReferenceOwner = candidate.symbol.references.some(
          (innerReference) =>
            (innerReference.flag !== "read" ||
              Boolean(findPatternAssignmentForIdentifier(innerReference.identifier))) &&
            context.cfg.enclosingFunction(innerReference.identifier) === referenceOwner,
        );
        if (hasWriteInReferenceOwner) continue;
        const hasUnclearedDirectInvocation = getDirectInvocationSites(context, referenceOwner).some(
          (invocation) =>
            context.cfg.enclosingFunction(invocation) === owner &&
            getNodeStartIndex(invocation) > sourceStart &&
            !flow.isClearedBefore(invocation),
        );
        if (!hasUnclearedDirectInvocation) continue;
      }
      if (flow.isClearedBefore(reference.identifier)) continue;
      const referenceRoot = findTransparentExpressionRoot(reference.identifier);
      if (expressionIsSynchronouslyConsumed(context, referenceRoot)) return true;
      const aliasCandidate = findRetainingAliasCandidate(
        context,
        reference.identifier,
        candidate.symbol,
      );
      if (aliasCandidate) pendingCandidates.push(aliasCandidate);
    }
  }
  return false;
};

const reportDirectDestructure = (
  context: RuleContext,
  expression: EsTreeNode,
  pattern: EsTreeNode,
): void => {
  if (!patternReadsDynamicApiValue(pattern)) return;
  const source = findPendingDynamicApiSource(context, expression);
  if (!source) return;
  context.report({ node: source, message: MESSAGE });
};

const reportAssignedPendingExpression = (
  context: RuleContext,
  expression: EsTreeNode,
  identifier: EsTreeNode,
): void => {
  const symbol = context.scopes.symbolFor(identifier);
  if (!symbol) return;
  const expressionOwner = context.cfg.enclosingFunction(expression);
  const bindingOwner = context.cfg.enclosingFunction(symbol.bindingIdentifier);
  if (expressionOwner === bindingOwner) {
    if (expressionIsStaticallySkipped(context, expression)) return;
  } else {
    if (!expressionOwner || !isFunctionLike(expressionOwner)) return;
    const invocationSites = getDirectInvocationSites(context, expressionOwner, {
      includeCallbackExecutionSites: false,
    });
    if (
      invocationSites.length === 0 ||
      invocationSites.every((invocationSite) =>
        expressionIsStaticallySkipped(context, expression, invocationSite),
      )
    ) {
      return;
    }
  }
  const source = findPendingDynamicApiSource(context, expression);
  if (!source) return;
  if (!symbolHasSynchronousAccess(context, symbol, expression)) return;
  context.report({ node: source, message: MESSAGE });
};

const collectPatternBindingIdentifiers = (
  pattern: EsTreeNode,
  identifiers: EsTreeNode[] = [],
): EsTreeNode[] => {
  if (isNodeOfType(pattern, "Identifier")) {
    identifiers.push(pattern);
  } else if (isNodeOfType(pattern, "AssignmentPattern")) {
    collectPatternBindingIdentifiers(pattern.left, identifiers);
  } else if (isNodeOfType(pattern, "RestElement")) {
    collectPatternBindingIdentifiers(pattern.argument, identifiers);
  } else if (isNodeOfType(pattern, "ObjectPattern")) {
    for (const property of pattern.properties) {
      if (isNodeOfType(property, "Property")) {
        collectPatternBindingIdentifiers(property.value, identifiers);
      } else if (isNodeOfType(property, "RestElement")) {
        collectPatternBindingIdentifiers(property.argument, identifiers);
      }
    }
  } else if (isNodeOfType(pattern, "ArrayPattern")) {
    for (const element of pattern.elements) {
      if (element) collectPatternBindingIdentifiers(element, identifiers);
    }
  }
  return identifiers;
};

const reportPatternAssignedPendingExpressions = (
  context: RuleContext,
  pattern: EsTreeNode,
  expression: EsTreeNode,
): void => {
  for (const bindingIdentifier of collectPatternBindingIdentifiers(pattern)) {
    const symbol = context.scopes.symbolFor(bindingIdentifier);
    if (!symbol) continue;
    const assignedValue = findPatternAssignedValue(context, pattern, expression, symbol);
    if (!assignedValue?.expression) continue;
    reportAssignedPendingExpression(context, assignedValue.expression, bindingIdentifier);
  }
};

const getDirectPatternBindingIdentifier = (pattern: EsTreeNode): EsTreeNode | null => {
  if (isNodeOfType(pattern, "Identifier")) return pattern;
  if (isNodeOfType(pattern, "AssignmentPattern") && isNodeOfType(pattern.left, "Identifier")) {
    return pattern.left;
  }
  return null;
};

const reportOfficialPropsPatternAliases = (
  context: RuleContext,
  pattern: EsTreeNode,
  expression: EsTreeNode,
): void => {
  if (!isNodeOfType(pattern, "ObjectPattern")) return;
  const propsSource = findOfficialPropsObjectSource(context, expression);
  if (!propsSource) return;
  for (const property of pattern.properties) {
    if (!isNodeOfType(property, "Property")) continue;
    const propertyName = getStaticPropertyKeyName(property, { allowComputedString: true });
    if (!propertyName || !propsSource.contract.propertyNames.has(propertyName)) continue;
    const bindingIdentifier = getDirectPatternBindingIdentifier(property.value);
    if (!bindingIdentifier) {
      context.report({ node: property, message: MESSAGE });
      continue;
    }
    const symbol = context.scopes.symbolFor(bindingIdentifier);
    if (!symbol || !symbolHasSynchronousAccess(context, symbol, property.value)) continue;
    context.report({ node: property, message: MESSAGE });
  }
};

const reportNestedOfficialParameterDestructure = (
  context: RuleContext,
  functionNode: EsTreeNode,
): void => {
  if (!isFunctionLike(functionNode)) return;
  const contract = getOfficialAsyncPropContract(context, functionNode);
  if (!contract) return;
  const parameter = functionNode.params[contract.parameterIndex];
  const pattern =
    parameter && isNodeOfType(parameter, "AssignmentPattern") ? parameter.left : parameter;
  if (!pattern || !isNodeOfType(pattern, "ObjectPattern")) return;
  for (const property of pattern.properties) {
    if (!isNodeOfType(property, "Property")) continue;
    const propertyName = getStaticPropertyKeyName(property, { allowComputedString: true });
    if (!propertyName || !contract.propertyNames.has(propertyName)) continue;
    if (!getDirectPatternBindingIdentifier(property.value)) {
      context.report({ node: property, message: MESSAGE });
    }
  }
};

const reportDirectSynchronousConsumption = (context: RuleContext, expression: EsTreeNode): void => {
  const source = findPendingDynamicApiSource(context, expression);
  if (source) context.report({ node: source, message: MESSAGE });
};

const reportOfficialDirectValueConsumption = (
  context: RuleContext,
  expression: EsTreeNode,
): void => {
  if (expressionIsStaticallySkipped(context, expression)) return;
  if (isOfficialDirectValueSource(context, expression)) {
    context.report({ node: expression, message: MESSAGE });
  }
};

const memberExpressionIsAssignmentTarget = (expression: EsTreeNode): boolean => {
  const root = findTransparentExpressionRoot(expression);
  const parent = root.parent;
  return Boolean(parent && isNodeOfType(parent, "AssignmentExpression") && parent.left === root);
};

const memberExpressionIsDirectlyUnwrapped = (
  context: RuleContext,
  expression: EsTreeNode,
): boolean => {
  const root = findTransparentExpressionRoot(expression);
  const parent = root.parent;
  if (parent && isNodeOfType(parent, "AwaitExpression") && parent.argument === root) return true;
  return Boolean(
    parent &&
    isNodeOfType(parent, "CallExpression") &&
    parent.arguments[0] === root &&
    isReactApiCall(parent, "use", context.scopes, { resolveNamedAliases: true }),
  );
};

export const nextjsAsyncDynamicApiNotAwaited = defineRule({
  id: "nextjs-async-dynamic-api-not-awaited",
  title: "Synchronous Next.js request API access",
  tags: ["test-noise"],
  requires: ["nextjs:15"],
  severity: "error",
  recommendation:
    "Await `cookies()`, `headers()`, `draftMode()`, and async route `params` or `searchParams`, or unwrap their promises with React `use()`, before reading properties.",
  create: (context: RuleContext) => ({
    FunctionDeclaration(node: EsTreeNodeOfType<"FunctionDeclaration">) {
      reportNestedOfficialParameterDestructure(context, node);
    },
    FunctionExpression(node: EsTreeNodeOfType<"FunctionExpression">) {
      reportNestedOfficialParameterDestructure(context, node);
    },
    ArrowFunctionExpression(node: EsTreeNodeOfType<"ArrowFunctionExpression">) {
      reportNestedOfficialParameterDestructure(context, node);
    },
    MemberExpression(node: EsTreeNodeOfType<"MemberExpression">) {
      if (node.computed) reportOfficialDirectValueConsumption(context, node.property);
      if (memberExpressionIsAssignmentTarget(node)) {
        const assignment = findTransparentExpressionRoot(node).parent;
        if (
          assignment &&
          isNodeOfType(assignment, "AssignmentExpression") &&
          assignment.operator !== "="
        ) {
          reportDirectSynchronousConsumption(context, node);
        }
        return;
      }
      if (memberExpressionIsDirectlyUnwrapped(context, node)) {
        return;
      }
      const source = findPendingDynamicApiSource(context, node.object);
      if (!source) return;
      if (isPromiseSettleAccess(context, node)) return;
      context.report({ node: source, message: MESSAGE });
    },
    VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
      if (!node.init) return;
      reportDirectDestructure(context, node.init, node.id);
      if (isNodeOfType(node.id, "Identifier")) {
        reportAssignedPendingExpression(context, node.init, node.id);
      } else {
        reportPatternAssignedPendingExpressions(context, node.id, node.init);
        reportOfficialPropsPatternAliases(context, node.id, node.init);
      }
    },
    AssignmentExpression(node: EsTreeNodeOfType<"AssignmentExpression">) {
      if (node.operator === "=") {
        reportDirectDestructure(context, node.right, node.left);
        if (!isNodeOfType(stripParenExpression(node.left), "Identifier")) {
          reportPatternAssignedPendingExpressions(context, node.left, node.right);
          reportOfficialPropsPatternAliases(context, node.left, node.right);
        }
      } else if (node.operator !== "&&=" && node.operator !== "||=" && node.operator !== "??=") {
        if (!isNodeOfType(stripParenExpression(node.left), "MemberExpression")) {
          reportDirectSynchronousConsumption(context, node.left);
        }
        return;
      }
      const assignmentTarget = stripParenExpression(node.left);
      if (!isNodeOfType(assignmentTarget, "Identifier")) return;
      if (node.operator === "&&=" || node.operator === "||=" || node.operator === "??=") {
        if (
          expressionMayRetainOfficialPendingValue(context, assignmentTarget) ||
          capturedSymbolMayBePendingAtInvocation(context, assignmentTarget)
        ) {
          context.report({ node: assignmentTarget, message: MESSAGE });
        }
      }
      reportAssignedPendingExpression(context, node.right, assignmentTarget);
    },
    UpdateExpression(node: EsTreeNodeOfType<"UpdateExpression">) {
      reportDirectSynchronousConsumption(context, node.argument);
    },
    Property(node: EsTreeNodeOfType<"Property">) {
      if (node.computed) reportOfficialDirectValueConsumption(context, node.key);
    },
    ConditionalExpression(node: EsTreeNodeOfType<"ConditionalExpression">) {
      reportOfficialDirectValueConsumption(context, node.test);
    },
    LogicalExpression(node: EsTreeNodeOfType<"LogicalExpression">) {
      reportOfficialDirectValueConsumption(context, node.left);
    },
    IfStatement(node: EsTreeNodeOfType<"IfStatement">) {
      reportOfficialDirectValueConsumption(context, node.test);
    },
    WhileStatement(node: EsTreeNodeOfType<"WhileStatement">) {
      reportOfficialDirectValueConsumption(context, node.test);
    },
    DoWhileStatement(node: EsTreeNodeOfType<"DoWhileStatement">) {
      reportOfficialDirectValueConsumption(context, node.test);
    },
    ForStatement(node: EsTreeNodeOfType<"ForStatement">) {
      if (node.test) reportOfficialDirectValueConsumption(context, node.test);
    },
    SwitchStatement(node: EsTreeNodeOfType<"SwitchStatement">) {
      reportOfficialDirectValueConsumption(context, node.discriminant);
    },
    SpreadElement(node: EsTreeNodeOfType<"SpreadElement">) {
      reportDirectSynchronousConsumption(context, node.argument);
    },
    ForInStatement(node: EsTreeNodeOfType<"ForInStatement">) {
      reportDirectSynchronousConsumption(context, node.right);
    },
    ForOfStatement(node: EsTreeNodeOfType<"ForOfStatement">) {
      reportDirectSynchronousConsumption(context, node.right);
    },
    YieldExpression(node: EsTreeNodeOfType<"YieldExpression">) {
      if (!node.delegate || !node.argument) return;
      reportDirectSynchronousConsumption(context, node.argument);
    },
    BinaryExpression(node: EsTreeNodeOfType<"BinaryExpression">) {
      if (node.operator === "in") {
        reportDirectSynchronousConsumption(context, node.right);
        reportOfficialDirectValueConsumption(context, node.left);
        return;
      }
      reportOfficialDirectValueConsumption(context, node.left);
      reportOfficialDirectValueConsumption(context, node.right);
    },
    UnaryExpression(node: EsTreeNodeOfType<"UnaryExpression">) {
      if (node.operator !== "void") reportOfficialDirectValueConsumption(context, node.argument);
    },
    TemplateLiteral(node: EsTreeNodeOfType<"TemplateLiteral">) {
      if (
        node.parent &&
        isNodeOfType(node.parent, "TaggedTemplateExpression") &&
        node.parent.quasi === node
      ) {
        const directTag = stripParenExpression(node.parent.tag);
        const aliasSymbol = isNodeOfType(directTag, "Identifier")
          ? resolveConstIdentifierAlias(directTag, context.scopes)
          : null;
        const tag = stripParenExpression(
          aliasSymbol?.kind === "const" && aliasSymbol.initializer
            ? aliasSymbol.initializer
            : directTag,
        );
        if (!isNodeOfType(tag, "MemberExpression")) return;
        const receiver = stripParenExpression(tag.object);
        if (
          !isNodeOfType(receiver, "Identifier") ||
          receiver.name !== "String" ||
          !context.scopes.isGlobalReference(receiver) ||
          getResolvedStaticPropertyName(tag, context.scopes) !== "raw"
        ) {
          return;
        }
      }
      for (const expression of node.expressions) {
        reportOfficialDirectValueConsumption(context, expression);
      }
    },
    JSXExpressionContainer(node: EsTreeNodeOfType<"JSXExpressionContainer">) {
      if (isAstNode(node.expression)) {
        reportOfficialDirectValueConsumption(context, node.expression);
      }
    },
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      for (const argument of node.arguments) {
        if (isNodeOfType(argument, "SpreadElement")) continue;
        if (isGlobalEnumerationCallForArgument(context, node, argument)) {
          reportDirectSynchronousConsumption(context, argument);
        }
        if (isGlobalCoercionCallForArgument(context, node, argument)) {
          reportOfficialDirectValueConsumption(context, argument);
        }
      }
    },
    NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
      for (const argument of node.arguments) {
        if (isNodeOfType(argument, "SpreadElement")) continue;
        if (!isGlobalIterableConstructorForArgument(context, node, argument)) continue;
        reportDirectSynchronousConsumption(context, argument);
      }
    },
  }),
});
