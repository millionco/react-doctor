import type {
  ScopeAnalysis,
  ScopeDescriptor,
  SymbolDescriptor,
} from "../../semantic/scope-analysis.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findRenderPhaseComponentOrHook } from "../../utils/find-render-phase-component-or-hook.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { getImportedName } from "../../utils/get-imported-name.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactApiCall } from "../../utils/is-react-api-call.js";
import { isWithinAssignmentTarget } from "../../utils/is-within-assignment-target.js";
import { resolveConstIdentifierAlias } from "../../utils/resolve-const-identifier-alias.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { RuleContext } from "../../utils/rule-context.js";

interface ProxyPath {
  readonly rootKey: string;
  readonly properties: ReadonlyArray<string | null>;
}

interface ProxyAliasCapture {
  readonly declarationEnd: number;
  readonly path: ProxyPath;
}

interface SnapshotTarget {
  readonly declarationEnd: number;
  readonly ownerFunction: EsTreeNode;
  readonly path: ProxyPath;
  readonly snapshotBindingScopes: ReadonlyArray<ScopeDescriptor>;
}

const VALTIO_REACT_MODULE_SOURCES = new Set(["valtio", "valtio/react"]);
const REACT_DEPENDENCY_ARRAY_HOOK_NAMES = new Set([
  "useCallback",
  "useEffect",
  "useInsertionEffect",
  "useLayoutEffect",
  "useMemo",
]);

const MESSAGE =
  "Read this Valtio value from the useSnapshot result during render. Keep proxy reads for callbacks so render uses the tracked, consistent snapshot.";

const isValtioImportSymbol = (symbol: SymbolDescriptor): boolean => {
  if (symbol.kind !== "import") return false;
  const importDeclaration = symbol.declarationNode.parent;
  return Boolean(
    importDeclaration &&
    isNodeOfType(importDeclaration, "ImportDeclaration") &&
    typeof importDeclaration.source.value === "string" &&
    VALTIO_REACT_MODULE_SOURCES.has(importDeclaration.source.value),
  );
};

const isValtioUseSnapshotCall = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  const callee = stripParenExpression(node.callee);
  if (isNodeOfType(callee, "Identifier")) {
    const symbol = resolveConstIdentifierAlias(callee, scopes);
    return Boolean(
      symbol &&
      isValtioImportSymbol(symbol) &&
      getImportedName(symbol.declarationNode) === "useSnapshot",
    );
  }
  if (
    !isNodeOfType(callee, "MemberExpression") ||
    getStaticPropertyName(callee) !== "useSnapshot"
  ) {
    return false;
  }
  const receiver = stripParenExpression(callee.object);
  if (!isNodeOfType(receiver, "Identifier")) return false;
  const namespaceSymbol = resolveConstIdentifierAlias(receiver, scopes);
  return Boolean(
    namespaceSymbol &&
    isValtioImportSymbol(namespaceSymbol) &&
    isNodeOfType(namespaceSymbol.declarationNode, "ImportNamespaceSpecifier"),
  );
};

const collectPatternBindingIdentifiers = (pattern: EsTreeNode): EsTreeNode[] => {
  if (isNodeOfType(pattern, "Identifier")) return [pattern];
  if (isNodeOfType(pattern, "AssignmentPattern")) {
    return collectPatternBindingIdentifiers(pattern.left);
  }
  if (isNodeOfType(pattern, "RestElement")) {
    return collectPatternBindingIdentifiers(pattern.argument);
  }
  if (isNodeOfType(pattern, "ArrayPattern")) {
    return pattern.elements.flatMap((element) =>
      element ? collectPatternBindingIdentifiers(element) : [],
    );
  }
  if (isNodeOfType(pattern, "ObjectPattern")) {
    return pattern.properties.flatMap((property) => {
      if (isNodeOfType(property, "Property")) {
        return collectPatternBindingIdentifiers(property.value);
      }
      return isNodeOfType(property, "RestElement")
        ? collectPatternBindingIdentifiers(property.argument)
        : [];
    });
  }
  return [];
};

const collectAssignmentWriteTargets = (target: EsTreeNode): EsTreeNode[] => {
  const candidate = stripParenExpression(target);
  if (isNodeOfType(candidate, "AssignmentPattern")) {
    return collectAssignmentWriteTargets(candidate.left);
  }
  if (isNodeOfType(candidate, "RestElement")) {
    return collectAssignmentWriteTargets(candidate.argument);
  }
  if (isNodeOfType(candidate, "ArrayPattern")) {
    return candidate.elements.flatMap((element) =>
      element ? collectAssignmentWriteTargets(element) : [],
    );
  }
  if (isNodeOfType(candidate, "ObjectPattern")) {
    return candidate.properties.flatMap((property) =>
      isNodeOfType(property, "Property")
        ? collectAssignmentWriteTargets(property.value)
        : collectAssignmentWriteTargets(property.argument),
    );
  }
  return [candidate];
};

const findPatternPathToBinding = (
  pattern: EsTreeNode,
  bindingIdentifier: EsTreeNode,
): string[] | null => {
  if (pattern === bindingIdentifier) return [];
  if (isNodeOfType(pattern, "AssignmentPattern")) {
    return findPatternPathToBinding(pattern.left, bindingIdentifier);
  }
  if (isNodeOfType(pattern, "RestElement")) return null;
  if (isNodeOfType(pattern, "ArrayPattern")) {
    for (const [elementIndex, element] of pattern.elements.entries()) {
      if (!element) continue;
      const nestedPath = findPatternPathToBinding(element, bindingIdentifier);
      if (nestedPath) return [String(elementIndex), ...nestedPath];
    }
    return null;
  }
  if (!isNodeOfType(pattern, "ObjectPattern")) return null;
  for (const property of pattern.properties) {
    if (!isNodeOfType(property, "Property")) continue;
    const nestedPath = findPatternPathToBinding(property.value, bindingIdentifier);
    if (!nestedPath) continue;
    const propertyName = getStaticPropertyKeyName(property);
    return propertyName === null ? null : [propertyName, ...nestedPath];
  }
  return null;
};

const resolveProxyPath = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds = new Set<number>(),
  allowedAliasSymbolIds: ReadonlySet<number> | null = null,
  collectedAliasCaptures: Map<number, ProxyAliasCapture> | null = null,
): ProxyPath | null => {
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "MemberExpression")) {
    const receiverPath = resolveProxyPath(
      candidate.object,
      scopes,
      visitedSymbolIds,
      allowedAliasSymbolIds,
      collectedAliasCaptures,
    );
    if (!receiverPath) return null;
    return {
      ...receiverPath,
      properties: [...receiverPath.properties, getStaticPropertyName(candidate)],
    };
  }
  if (!isNodeOfType(candidate, "Identifier")) return null;
  const symbol = scopes.symbolFor(candidate);
  if (!symbol) {
    return scopes.isGlobalReference(candidate)
      ? { rootKey: `global:${candidate.name}`, properties: [] }
      : null;
  }
  if (visitedSymbolIds.has(symbol.id)) return null;
  if (
    symbol.kind === "const" &&
    symbol.initializer &&
    isNodeOfType(symbol.declarationNode, "VariableDeclarator")
  ) {
    const directAlias = symbol.declarationNode.id === symbol.bindingIdentifier;
    const initializerNode = directAlias ? symbol.initializer : symbol.declarationNode.init;
    if (!initializerNode) return { rootKey: `symbol:${symbol.id}`, properties: [] };
    const initializer = stripParenExpression(initializerNode);
    const canResolveDirectAlias =
      directAlias &&
      (isNodeOfType(initializer, "Identifier") || isNodeOfType(initializer, "MemberExpression"));
    const patternPath = directAlias
      ? null
      : findPatternPathToBinding(symbol.declarationNode.id, symbol.bindingIdentifier);
    if (
      (canResolveDirectAlias || patternPath) &&
      (allowedAliasSymbolIds === null || allowedAliasSymbolIds.has(symbol.id))
    ) {
      const nextVisitedSymbolIds = new Set(visitedSymbolIds);
      nextVisitedSymbolIds.add(symbol.id);
      const initializerPath = resolveProxyPath(
        initializer,
        scopes,
        nextVisitedSymbolIds,
        allowedAliasSymbolIds,
        collectedAliasCaptures,
      );
      if (initializerPath) {
        const aliasPath = {
          ...initializerPath,
          properties: [...initializerPath.properties, ...(patternPath ?? [])],
        };
        const declarationEnd = symbol.declarationNode.range?.[1];
        if (typeof declarationEnd === "number") {
          collectedAliasCaptures?.set(symbol.id, { declarationEnd, path: aliasPath });
        }
        return aliasPath;
      }
    }
  }
  return { rootKey: `symbol:${symbol.id}`, properties: [] };
};

const isScopeWithin = (
  candidateScope: ScopeDescriptor,
  ancestorScope: ScopeDescriptor,
): boolean => {
  let currentScope: ScopeDescriptor | null = candidateScope;
  while (currentScope) {
    if (currentScope === ancestorScope) return true;
    currentScope = currentScope.parent;
  }
  return false;
};

const isPathPrefix = (prefix: ProxyPath, candidate: ProxyPath): boolean => {
  if (
    prefix.rootKey !== candidate.rootKey ||
    prefix.properties.length > candidate.properties.length
  ) {
    return false;
  }
  return prefix.properties.every(
    (propertyName, propertyIndex) =>
      propertyName !== null && propertyName === candidate.properties[propertyIndex],
  );
};

const findOutermostMemberRead = (identifier: EsTreeNode): EsTreeNode => {
  let currentExpression = findTransparentExpressionRoot(identifier);
  for (;;) {
    const parent = currentExpression.parent;
    if (
      !isNodeOfType(parent, "MemberExpression") ||
      stripParenExpression(parent.object) !== stripParenExpression(currentExpression)
    ) {
      return currentExpression;
    }
    currentExpression = findTransparentExpressionRoot(parent);
  }
};

const isReadPositionWithinAssignmentTarget = (expression: EsTreeNode): boolean => {
  let currentNode = expression;
  let parentNode = currentNode.parent;
  while (parentNode) {
    if (
      (isNodeOfType(parentNode, "MemberExpression") &&
        parentNode.computed &&
        parentNode.property === currentNode) ||
      (isNodeOfType(parentNode, "Property") &&
        parentNode.computed &&
        parentNode.key === currentNode) ||
      (isNodeOfType(parentNode, "AssignmentPattern") && parentNode.right === currentNode)
    ) {
      return true;
    }
    if (
      isNodeOfType(parentNode, "AssignmentExpression") ||
      isNodeOfType(parentNode, "UpdateExpression") ||
      (isNodeOfType(parentNode, "UnaryExpression") && parentNode.operator === "delete") ||
      isNodeOfType(parentNode, "ForInStatement") ||
      isNodeOfType(parentNode, "ForOfStatement")
    ) {
      return false;
    }
    currentNode = parentNode;
    parentNode = currentNode.parent;
  }
  return false;
};

const isSnapshotArgument = (expression: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const expressionRoot = findTransparentExpressionRoot(expression);
  const parent = expressionRoot.parent;
  return Boolean(
    parent &&
    isNodeOfType(parent, "CallExpression") &&
    isValtioUseSnapshotCall(parent, scopes) &&
    parent.arguments[0] === expressionRoot,
  );
};

const isStableProxyDependency = (
  expression: EsTreeNode,
  readPath: ProxyPath,
  matchingTarget: SnapshotTarget,
  scopes: ScopeAnalysis,
): boolean => {
  if (
    readPath.properties.length !== matchingTarget.path.properties.length ||
    !isPathPrefix(matchingTarget.path, readPath)
  ) {
    return false;
  }
  const expressionRoot = findTransparentExpressionRoot(expression);
  const dependencyArray = expressionRoot.parent;
  if (!isNodeOfType(dependencyArray, "ArrayExpression")) return false;
  const hookCall = dependencyArray.parent;
  return Boolean(
    isNodeOfType(hookCall, "CallExpression") &&
    hookCall.arguments[1] === dependencyArray &&
    isReactApiCall(hookCall, REACT_DEPENDENCY_ARRAY_HOOK_NAMES, scopes, {
      allowGlobalReactNamespace: true,
    }),
  );
};

const getSnapshotTarget = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): SnapshotTarget | null => {
  if (!isValtioUseSnapshotCall(callExpression, context.scopes)) return null;
  const proxyArgument = callExpression.arguments[0];
  if (!proxyArgument || isNodeOfType(proxyArgument, "SpreadElement")) return null;
  const path = resolveProxyPath(proxyArgument, context.scopes);
  if (!path || path.properties.some((propertyName) => propertyName === null)) return null;
  const callExpressionRoot = findTransparentExpressionRoot(callExpression);
  const declarator = callExpressionRoot.parent;
  if (
    !isNodeOfType(declarator, "VariableDeclarator") ||
    declarator.init !== callExpressionRoot ||
    !isNodeOfType(declarator.parent, "VariableDeclaration")
  ) {
    return null;
  }
  const ownerFunction = findRenderPhaseComponentOrHook(callExpression, context.scopes);
  if (!ownerFunction) return null;
  const snapshotBindingScopes = collectPatternBindingIdentifiers(declarator.id).flatMap(
    (bindingIdentifier) => {
      const bindingSymbol = context.scopes.symbolFor(bindingIdentifier);
      return bindingSymbol ? [bindingSymbol.scope] : [];
    },
  );
  const declarationEnd = declarator.range?.[1];
  if (snapshotBindingScopes.length === 0 || typeof declarationEnd !== "number") return null;
  return {
    declarationEnd,
    ownerFunction,
    path,
    snapshotBindingScopes,
  };
};

const wasTargetReplacedBeforeRead = (
  target: SnapshotTarget,
  readPosition: number,
  writeTargets: ReadonlyArray<EsTreeNode>,
  readAliasCaptures: ReadonlyMap<number, ProxyAliasCapture>,
  context: RuleContext,
): boolean =>
  writeTargets.some((writeTarget) => {
    const writeNode = findTransparentExpressionRoot(writeTarget).parent;
    const writePosition = writeNode?.range?.[0];
    if (
      !writeNode ||
      typeof writePosition !== "number" ||
      writePosition <= target.declarationEnd ||
      writePosition >= readPosition ||
      findRenderPhaseComponentOrHook(writeNode, context.scopes) !== target.ownerFunction
    ) {
      return false;
    }
    const writePath = resolveProxyPath(writeTarget, context.scopes, new Set(), null);
    if (!writePath || !isPathPrefix(writePath, target.path)) return false;
    return ![...readAliasCaptures.values()].some(
      (aliasCapture) =>
        aliasCapture.declarationEnd < writePosition && isPathPrefix(writePath, aliasCapture.path),
    );
  });

export const valtioNoProxyReadInRender = defineRule({
  id: "valtio-no-proxy-read-in-render",
  title: "Valtio proxy read during render",
  severity: "warn",
  recommendation:
    "Read reactive render values from useSnapshot. Reserve the mutable proxy for event handlers, effects, and other callbacks that need the latest value.",
  requires: ["valtio:1"],
  create: (context: RuleContext) => {
    const snapshotTargets: SnapshotTarget[] = [];
    const identifierCandidates: EsTreeNode[] = [];
    const writeTargets: EsTreeNode[] = [];
    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        const snapshotTarget = getSnapshotTarget(node, context);
        if (snapshotTarget) snapshotTargets.push(snapshotTarget);
      },
      Identifier(node: EsTreeNodeOfType<"Identifier">) {
        if (context.scopes.referenceFor(node)) identifierCandidates.push(node);
      },
      AssignmentExpression(node: EsTreeNodeOfType<"AssignmentExpression">) {
        writeTargets.push(...collectAssignmentWriteTargets(node.left));
      },
      UpdateExpression(node: EsTreeNodeOfType<"UpdateExpression">) {
        writeTargets.push(node.argument);
      },
      "Program:exit"() {
        const reportedExpressions = new Set<EsTreeNode>();
        for (const identifier of identifierCandidates) {
          const readExpression = findOutermostMemberRead(identifier);
          if (
            reportedExpressions.has(readExpression) ||
            (isWithinAssignmentTarget(readExpression) &&
              !isReadPositionWithinAssignmentTarget(readExpression)) ||
            isSnapshotArgument(readExpression, context.scopes)
          ) {
            continue;
          }
          const readAliasCaptures = new Map<number, ProxyAliasCapture>();
          const readPath = resolveProxyPath(
            readExpression,
            context.scopes,
            new Set(),
            null,
            readAliasCaptures,
          );
          const readPosition = readExpression.range?.[0];
          const ownerFunction = findRenderPhaseComponentOrHook(readExpression, context.scopes);
          if (!readPath || typeof readPosition !== "number" || !ownerFunction) continue;
          const readScope = context.scopes.scopeFor(readExpression);
          const matchingTarget = snapshotTargets.find(
            (target) =>
              target.ownerFunction === ownerFunction &&
              target.declarationEnd < readPosition &&
              target.snapshotBindingScopes.some((bindingScope) =>
                isScopeWithin(readScope, bindingScope),
              ) &&
              isPathPrefix(target.path, readPath) &&
              (readAliasCaptures.size === 0 ||
                [...readAliasCaptures.values()].some(
                  (aliasCapture) =>
                    isPathPrefix(aliasCapture.path, target.path) ||
                    (isPathPrefix(target.path, aliasCapture.path) &&
                      readPath.properties.length > aliasCapture.path.properties.length),
                )) &&
              !wasTargetReplacedBeforeRead(
                target,
                readPosition,
                writeTargets,
                readAliasCaptures,
                context,
              ),
          );
          if (
            !matchingTarget ||
            isStableProxyDependency(readExpression, readPath, matchingTarget, context.scopes)
          ) {
            continue;
          }
          reportedExpressions.add(readExpression);
          context.report({ node: readExpression, message: MESSAGE });
        }
      },
    };
  },
});
