import * as path from "node:path";
import {
  analyzeScopes,
  type ScopeAnalysis,
  type SymbolDescriptor,
} from "../semantic/scope-analysis.js";
import { componentOrHookDisplayNameForFunction } from "./component-or-hook-display-name.js";
import { collectFunctionReturnStatements } from "./collect-function-return-statements.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { findProgramRoot } from "./find-program-root.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { resolveImportedExportName } from "./find-exported-function-body.js";
import { getImportDeclarationForSymbol } from "./get-import-declaration-for-symbol.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isReactApiCall } from "./is-react-api-call.js";
import { isReactHookName } from "./is-react-hook-name.js";
import { isWithinAssignmentTarget } from "./is-within-assignment-target.js";
import { resolveConstIdentifierAlias } from "./resolve-const-identifier-alias.js";
import { resolveCrossFileFunctionExportWithFilePath } from "./resolve-cross-file-function-export.js";
import { resolveExactLocalFunction } from "./resolve-exact-local-function.js";
import { resolveClosedReactProviderPath } from "./resolve-tsconfig-alias.js";
import { walkAst } from "./walk-ast.js";
import { stripParenExpression } from "./strip-paren-expression.js";

interface ServerSnapshotBooleanResult {
  hasUseSyncExternalStoreOrigin: boolean;
  value: boolean;
}

interface ImportedHookBinding {
  exportedName: string;
  source: string;
}

const crossFileScopes = new WeakMap<EsTreeNode, ScopeAnalysis>();

const getCrossFileScopes = (programNode: EsTreeNode): ScopeAnalysis => {
  const cachedScopes = crossFileScopes.get(programNode);
  if (cachedScopes) return cachedScopes;
  const scopes = analyzeScopes(programNode);
  crossFileScopes.set(programNode, scopes);
  return scopes;
};

const symbolIsImmutable = (symbol: SymbolDescriptor): boolean =>
  (symbol.kind === "const" || symbol.kind === "function") &&
  symbol.references.every((reference) => reference.flag === "read");

const identifierAliasChainIsImmutable = (
  identifier: EsTreeNode,
  scopes: ScopeAnalysis,
  allowImportTerminal = false,
): boolean => {
  if (!isNodeOfType(identifier, "Identifier")) return false;
  const visitedSymbolIds = new Set<number>();
  let symbol = scopes.symbolFor(identifier);
  while (symbol) {
    if (symbol.kind === "import") return allowImportTerminal;
    if (visitedSymbolIds.has(symbol.id) || !symbolIsImmutable(symbol)) return false;
    visitedSymbolIds.add(symbol.id);
    if (symbol.kind !== "const" || !symbol.initializer) return symbol.kind === "function";
    const initializer = stripParenExpression(symbol.initializer);
    if (!isNodeOfType(initializer, "Identifier")) return true;
    symbol = scopes.symbolFor(initializer);
  }
  return false;
};

const getImportedHookBinding = (
  callee: EsTreeNode,
  scopes: ScopeAnalysis,
): ImportedHookBinding | null => {
  if (
    !isNodeOfType(callee, "Identifier") ||
    !identifierAliasChainIsImmutable(callee, scopes, true)
  ) {
    return null;
  }
  const importedSymbol = resolveConstIdentifierAlias(callee, scopes);
  if (importedSymbol?.kind !== "import") return null;
  const importDeclaration = importedSymbol.declarationNode.parent;
  if (!importDeclaration || !isNodeOfType(importDeclaration, "ImportDeclaration")) return null;
  const source = importDeclaration.source.value;
  if (typeof source !== "string") return null;
  const exportedName = resolveImportedExportName(importedSymbol.declarationNode);
  return exportedName ? { exportedName, source } : null;
};

const functionBindingIsImmutable = (functionNode: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (isNodeOfType(functionNode, "FunctionDeclaration") && functionNode.id) {
    const symbol = scopes.symbolFor(functionNode.id);
    return Boolean(symbol && symbolIsImmutable(symbol));
  }
  const expressionRoot = findTransparentExpressionRoot(functionNode);
  const parentNode = expressionRoot.parent;
  if (isNodeOfType(parentNode, "ExportDefaultDeclaration")) return true;
  if (
    !isNodeOfType(parentNode, "VariableDeclarator") ||
    parentNode.init !== expressionRoot ||
    !isNodeOfType(parentNode.id, "Identifier")
  ) {
    return false;
  }
  const symbol = scopes.symbolFor(parentNode.id);
  return Boolean(symbol && symbolIsImmutable(symbol));
};

const getExactFunctionResultExpression = (functionNode: EsTreeNode): EsTreeNode | null => {
  if (!isFunctionLike(functionNode) || functionNode.async) return null;
  if (isNodeOfType(functionNode, "FunctionDeclaration") && functionNode.generator) return null;
  if (isNodeOfType(functionNode, "FunctionExpression") && functionNode.generator) return null;
  if (!isNodeOfType(functionNode.body, "BlockStatement")) return functionNode.body;
  const [returnStatement, additionalReturnStatement] =
    collectFunctionReturnStatements(functionNode);
  if (!returnStatement || additionalReturnStatement || !returnStatement.argument) return null;
  const statements = [...functionNode.body.body];
  if (statements.pop() !== returnStatement) return null;
  return returnStatement.argument;
};

const functionHasNoParameters = (functionNode: EsTreeNode): boolean =>
  isFunctionLike(functionNode) && (functionNode.params?.length ?? 0) === 0;

const readImmutableBooleanLiteral = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number>,
): boolean | null => {
  const unwrappedExpression = stripParenExpression(expression);
  if (
    isNodeOfType(unwrappedExpression, "Literal") &&
    typeof unwrappedExpression.value === "boolean"
  ) {
    return unwrappedExpression.value;
  }
  if (!isNodeOfType(unwrappedExpression, "Identifier")) return null;
  const symbol = scopes.symbolFor(unwrappedExpression);
  if (
    !symbol ||
    symbol.kind !== "const" ||
    !symbol.initializer ||
    !symbolIsImmutable(symbol) ||
    visitedSymbolIds.has(symbol.id)
  ) {
    return null;
  }
  visitedSymbolIds.add(symbol.id);
  return readImmutableBooleanLiteral(symbol.initializer, scopes, visitedSymbolIds);
};

const readFunctionLiteralBoolean = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean | null => {
  const unwrappedExpression = stripParenExpression(expression);
  if (
    isNodeOfType(unwrappedExpression, "Identifier") &&
    !identifierAliasChainIsImmutable(unwrappedExpression, scopes)
  ) {
    return null;
  }
  const functionNode = resolveExactLocalFunction(unwrappedExpression, scopes);
  if (!functionNode) return null;
  const resultExpression = getExactFunctionResultExpression(functionNode);
  return resultExpression ? readImmutableBooleanLiteral(resultExpression, scopes, new Set()) : null;
};

const readServerSnapshotBooleanInternal = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number>,
  visitedFunctionNodes: Set<EsTreeNode>,
  currentFilename: string | undefined,
): ServerSnapshotBooleanResult | null => {
  const unwrappedExpression = stripParenExpression(expression);
  if (
    isNodeOfType(unwrappedExpression, "Literal") &&
    typeof unwrappedExpression.value === "boolean"
  ) {
    return {
      hasUseSyncExternalStoreOrigin: false,
      value: unwrappedExpression.value,
    };
  }
  if (isNodeOfType(unwrappedExpression, "Identifier")) {
    const symbol = scopes.symbolFor(unwrappedExpression);
    if (
      !symbol ||
      symbol.kind !== "const" ||
      !symbol.initializer ||
      !symbolIsImmutable(symbol) ||
      visitedSymbolIds.has(symbol.id)
    ) {
      return null;
    }
    visitedSymbolIds.add(symbol.id);
    return readServerSnapshotBooleanInternal(
      symbol.initializer,
      scopes,
      visitedSymbolIds,
      visitedFunctionNodes,
      currentFilename,
    );
  }
  if (
    isNodeOfType(unwrappedExpression, "UnaryExpression") &&
    unwrappedExpression.operator === "!"
  ) {
    const argumentResult = readServerSnapshotBooleanInternal(
      unwrappedExpression.argument,
      scopes,
      visitedSymbolIds,
      visitedFunctionNodes,
      currentFilename,
    );
    return argumentResult
      ? {
          hasUseSyncExternalStoreOrigin: argumentResult.hasUseSyncExternalStoreOrigin,
          value: !argumentResult.value,
        }
      : null;
  }
  if (
    isNodeOfType(unwrappedExpression, "LogicalExpression") &&
    (unwrappedExpression.operator === "&&" || unwrappedExpression.operator === "||")
  ) {
    const leftResult = readServerSnapshotBooleanInternal(
      unwrappedExpression.left,
      scopes,
      new Set(visitedSymbolIds),
      new Set(visitedFunctionNodes),
      currentFilename,
    );
    if (
      leftResult &&
      ((unwrappedExpression.operator === "&&" && !leftResult.value) ||
        (unwrappedExpression.operator === "||" && leftResult.value))
    ) {
      return leftResult;
    }
    const rightResult = readServerSnapshotBooleanInternal(
      unwrappedExpression.right,
      scopes,
      new Set(visitedSymbolIds),
      new Set(visitedFunctionNodes),
      currentFilename,
    );
    if (
      rightResult &&
      ((unwrappedExpression.operator === "&&" && !rightResult.value) ||
        (unwrappedExpression.operator === "||" && rightResult.value))
    ) {
      return rightResult;
    }
    return leftResult && rightResult
      ? {
          hasUseSyncExternalStoreOrigin:
            leftResult.hasUseSyncExternalStoreOrigin || rightResult.hasUseSyncExternalStoreOrigin,
          value: rightResult.value,
        }
      : null;
  }
  if (!isNodeOfType(unwrappedExpression, "CallExpression")) return null;
  if (
    isReactApiCall(unwrappedExpression, "useSyncExternalStore", scopes, {
      resolveNamedAliases: true,
    })
  ) {
    const [, , serverSnapshotArgument] = unwrappedExpression.arguments ?? [];
    if (!serverSnapshotArgument || isNodeOfType(serverSnapshotArgument, "SpreadElement")) {
      return null;
    }
    const serverSnapshotValue = readFunctionLiteralBoolean(serverSnapshotArgument, scopes);
    return serverSnapshotValue === null
      ? null
      : {
          hasUseSyncExternalStoreOrigin: true,
          value: serverSnapshotValue,
        };
  }
  if ((unwrappedExpression.arguments?.length ?? 0) !== 0) return null;
  const callee = stripParenExpression(unwrappedExpression.callee);
  const importedHookBinding = getImportedHookBinding(callee, scopes);
  if (importedHookBinding && currentFilename) {
    const resolvedHook = resolveCrossFileFunctionExportWithFilePath(
      path.resolve(currentFilename),
      importedHookBinding.source,
      importedHookBinding.exportedName,
    );
    if (resolvedHook && !resolvedHook.filePath.split(path.sep).includes("node_modules")) {
      const resolvedScopes = getCrossFileScopes(resolvedHook.programNode);
      const displayName =
        componentOrHookDisplayNameForFunction(resolvedHook.functionNode) ??
        (importedHookBinding.exportedName === "default" && isNodeOfType(callee, "Identifier")
          ? callee.name
          : importedHookBinding.exportedName);
      if (
        isReactHookName(displayName) &&
        functionHasNoParameters(resolvedHook.functionNode) &&
        functionBindingIsImmutable(resolvedHook.functionNode, resolvedScopes) &&
        !visitedFunctionNodes.has(resolvedHook.functionNode)
      ) {
        visitedFunctionNodes.add(resolvedHook.functionNode);
        const resultExpression = getExactFunctionResultExpression(resolvedHook.functionNode);
        if (resultExpression) {
          return readServerSnapshotBooleanInternal(
            resultExpression,
            resolvedScopes,
            new Set(),
            visitedFunctionNodes,
            resolvedHook.filePath,
          );
        }
      }
    }
    return null;
  }
  if (
    !isNodeOfType(callee, "Identifier") ||
    !isReactHookName(callee.name) ||
    !identifierAliasChainIsImmutable(callee, scopes)
  ) {
    return null;
  }
  const hookFunction = resolveExactLocalFunction(callee, scopes);
  if (
    !hookFunction ||
    !functionHasNoParameters(hookFunction) ||
    visitedFunctionNodes.has(hookFunction)
  ) {
    return null;
  }
  visitedFunctionNodes.add(hookFunction);
  const resultExpression = getExactFunctionResultExpression(hookFunction);
  return resultExpression
    ? readServerSnapshotBooleanInternal(
        resultExpression,
        scopes,
        visitedSymbolIds,
        visitedFunctionNodes,
        currentFilename,
      )
    : null;
};

export const readServerSnapshotBoolean = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  currentFilename?: string,
): boolean | null => {
  const result = readServerSnapshotBooleanInternal(
    expression,
    scopes,
    new Set(),
    new Set(),
    currentFilename,
  );
  return result?.hasUseSyncExternalStoreOrigin ? result.value : null;
};

const hasClosedBinding = (symbol: SymbolDescriptor, program: EsTreeNode, scopes: ScopeAnalysis) =>
  hasCompleteSymbolReferences(symbol, program, scopes) &&
  symbol.references.every(
    ({ flag, identifier }) => flag === "read" && !isWithinAssignmentTarget(identifier),
  );

const directEvalByProgram = new WeakMap<EsTreeNode, boolean>();

const hasDirectEval = (program: EsTreeNode): boolean => {
  const cached = directEvalByProgram.get(program);
  if (cached !== undefined) return cached;
  let found = false;
  walkAst(program, (node) => {
    if (found) return false;
    if (isNodeOfType(node, "CallExpression")) {
      const callee = stripParenExpression(node.callee);
      found = isNodeOfType(callee, "Identifier") && callee.name === "eval";
    }
    return undefined;
  });
  directEvalByProgram.set(program, found);
  return found;
};

const getClosedDirectImport = (
  node: EsTreeNode,
  program: EsTreeNode,
  scopes: ScopeAnalysis,
): ImportedHookBinding | null => {
  const identifier = stripParenExpression(node);
  if (!isNodeOfType(identifier, "Identifier")) return null;
  const symbol = scopes.symbolFor(identifier);
  if (!symbol || !isNodeOfType(symbol.declarationNode, "ImportSpecifier")) return null;
  const specifier = symbol.declarationNode;
  const declaration = getImportDeclarationForSymbol(symbol);
  return declaration?.parent === program &&
    declaration.importKind !== "type" &&
    specifier.importKind !== "type" &&
    hasClosedBinding(symbol, program, scopes)
    ? getImportedHookBinding(identifier, scopes)
    : null;
};

export const isClosedImportedServerSnapshotFalse = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  filename?: string,
): boolean => {
  if (!filename) return false;
  let leading = stripParenExpression(expression);
  while (isNodeOfType(leading, "LogicalExpression") && leading.operator === "&&") {
    leading = stripParenExpression(leading.left);
  }
  if (!isNodeOfType(leading, "Identifier")) return false;
  const gate = scopes.symbolFor(leading);
  const program = findProgramRoot(leading);
  const owner = findEnclosingFunction(leading);
  if (
    !program ||
    !owner ||
    gate?.kind !== "const" ||
    !isNodeOfType(gate.declarationNode, "VariableDeclarator") ||
    gate.declarationNode.id !== gate.bindingIdentifier ||
    findEnclosingFunction(gate.declarationNode) !== owner ||
    !gate.initializer ||
    !hasClosedBinding(gate, program, scopes) ||
    hasDirectEval(program)
  )
    return false;

  const hookCall = stripParenExpression(gate.initializer);
  if (!isNodeOfType(hookCall, "CallExpression") || hookCall.optional || hookCall.arguments.length) {
    return false;
  }
  const imported = getClosedDirectImport(hookCall.callee, program, scopes);
  if (!imported || !isReactHookName(imported.exportedName)) return false;
  const from = path.resolve(filename);
  const directPath = resolveClosedReactProviderPath(from, imported.source);
  if (!directPath) return false;
  const resolved = resolveCrossFileFunctionExportWithFilePath(
    from,
    imported.source,
    imported.exportedName,
  );
  if (resolved?.filePath !== directPath) return false;

  const { functionNode: fn, programNode: provider } = resolved;
  if (
    !isNodeOfType(fn, "FunctionDeclaration") ||
    fn.id?.name !== imported.exportedName ||
    !isNodeOfType(fn.parent, "ExportNamedDeclaration") ||
    fn.parent.declaration !== fn ||
    fn.parent.parent !== provider ||
    !functionHasNoParameters(fn) ||
    !isNodeOfType(fn.body, "BlockStatement") ||
    fn.body.body.length !== 1 ||
    hasDirectEval(provider)
  )
    return false;

  const providerScopes = getCrossFileScopes(provider);
  const declarations = providerScopes.rootScope.symbols.filter(
    (symbol) => symbol.bindingIdentifier === fn.id,
  );
  const bindings = [...declarations, ...(providerScopes.ownScopeFor(fn)?.symbols ?? [])];
  if (
    declarations.length !== 1 ||
    bindings.some(
      (symbol) =>
        symbol.bindingIdentifier === fn.id && !hasClosedBinding(symbol, provider, providerScopes),
    )
  )
    return false;

  const resultExpression = getExactFunctionResultExpression(fn);
  if (!resultExpression) return false;
  const call = stripParenExpression(resultExpression);
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    call.arguments.length !== 3 ||
    call.arguments.some((argument) => isNodeOfType(argument, "SpreadElement"))
  )
    return false;

  const react = getClosedDirectImport(call.callee, provider, providerScopes);
  const [rawSubscription, rawClient, snapshot] = call.arguments;
  if (
    react?.source !== "react" ||
    react.exportedName !== "useSyncExternalStore" ||
    !rawSubscription ||
    !rawClient ||
    !snapshot
  )
    return false;
  const subscription = stripParenExpression(rawSubscription);
  const subscriptionBinding = isNodeOfType(subscription, "Identifier")
    ? providerScopes.symbolFor(subscription)
    : null;
  const client = stripParenExpression(rawClient);
  if (
    !isFunctionLike(subscription) &&
    (subscriptionBinding?.kind !== "function" ||
      !hasClosedBinding(subscriptionBinding, provider, providerScopes))
  )
    return false;
  if (!isNodeOfType(client, "ArrowFunctionExpression") || client.async || client.params.length) {
    return false;
  }
  const server = stripParenExpression(snapshot);
  return (
    isNodeOfType(server, "ArrowFunctionExpression") &&
    !server.async &&
    server.params.length === 0 &&
    isNodeOfType(stripParenExpression(server.body), "Literal") &&
    readServerSnapshotBoolean(call, providerScopes) === false
  );
};
