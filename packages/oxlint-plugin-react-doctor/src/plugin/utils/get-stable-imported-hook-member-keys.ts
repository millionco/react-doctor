import { hasStandardReactJsxConfiguration } from "./resolve-tsconfig-alias.js";
import { resolveWebpackAliasPath } from "./resolve-webpack-alias-path.js";
import { HOOK_NAME_PATTERN, REACT_JSX_PROVIDER_MODULE_SOURCES } from "../constants/react.js";
import { closureCaptures } from "../semantic/closure-captures.js";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import { collectFunctionReturnStatements } from "./collect-function-return-statements.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getFunctionBindingSymbols } from "./get-function-binding-symbols.js";
import { isProvenGlobalNamespaceReference } from "./is-proven-global-namespace-reference.js";
import { getDestructuredBindingPropertyName } from "./get-destructured-binding-property-name.js";
import { getRuntimeStaticDependencySource } from "./get-runtime-static-dependency-source.js";
import { getResolvedStaticPropertyName } from "./get-resolved-static-property-name.js";
import { getFunctionBindingName } from "./get-function-binding-name.js";
import { getGlobalRequireModuleSource } from "./get-global-require-module-source.js";
import { getImportDeclarationForSymbol } from "./get-import-declaration-for-symbol.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { hasReactDefaultProviderMutation } from "./has-react-default-provider-mutation.js";
import { hasSymbolBindingWrites } from "./has-symbol-binding-writes.js";
import { isMemberMutationTarget } from "./is-member-mutation-target.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isFunctionLike } from "./is-function-like.js";
import { hasLexicalReceiverReference } from "./has-lexical-receiver-reference.js";
import { isReactComponentOrHookName } from "./is-react-component-or-hook-name.js";
import { isUnmodifiedLocalReactStateCall } from "./is-unmodified-local-react-state-call.js";
import { resolveCrossFileFunctionExportWithFilePath } from "./resolve-cross-file-function-export.js";
import { resolveModulePath } from "./resolve-module-path.js";
import { walkAst } from "./walk-ast.js";

export interface ImportedHookMemberOptions {
  readonly symbol: SymbolDescriptor;
  readonly scopes: ScopeAnalysis;
  readonly filename: string | undefined;
}

const scopesByProgram = new WeakMap<EsTreeNode, ScopeAnalysis>();

const hasUnaliasedReactStateProviderConfiguration = (
  filename: string,
  allowIdentityPaths = false,
): boolean =>
  hasStandardReactJsxConfiguration(filename, {
    requireUnaliasedReact: true,
    allowIdentityPathMapping: allowIdentityPaths,
  }) &&
  (allowIdentityPaths
    ? [...REACT_JSX_PROVIDER_MODULE_SOURCES].every(
        (source) =>
          !resolveWebpackAliasPath(filename, source)?.declared &&
          !resolveModulePath(filename, source),
      )
    : !resolveWebpackAliasPath(filename, "react")?.declared &&
      !resolveModulePath(filename, "react"));

const isReadonlyBinding = (symbol: SymbolDescriptor, scopes: ScopeAnalysis): boolean =>
  !hasSymbolBindingWrites(symbol) &&
  hasCompleteSymbolReferences(symbol, scopes.rootScope.node, scopes);

const getReturnedArrow = (
  value: EsTreeNode,
  hookBody: EsTreeNode,
  scopes: ScopeAnalysis,
): EsTreeNodeOfType<"ArrowFunctionExpression"> | null => {
  let arrow = value;
  if (isNodeOfType(value, "Identifier")) {
    const symbol = scopes.symbolFor(value);
    const declaration = symbol?.declarationNode;
    const statement = declaration?.parent;
    if (
      !symbol ||
      symbol.kind !== "const" ||
      !isReadonlyBinding(symbol, scopes) ||
      !isNodeOfType(declaration, "VariableDeclarator") ||
      declaration.id !== symbol.bindingIdentifier ||
      !isNodeOfType(statement, "VariableDeclaration") ||
      statement.kind !== "const" ||
      statement.parent !== hookBody ||
      !declaration.init ||
      declaration.range[0] >= value.range[0]
    )
      return null;
    arrow = declaration.init;
  }
  return isNodeOfType(arrow, "ArrowFunctionExpression") &&
    !arrow.async &&
    !hasLexicalReceiverReference(arrow, scopes)
    ? arrow
    : null;
};

const capturesOnlyOwnedStateSetters = (
  arrow: EsTreeNode,
  hookBody: EsTreeNode,
  scopes: ScopeAnalysis,
  hookName: "useState" | "useReducer" = "useState",
): boolean => {
  const captures = closureCaptures(arrow, scopes);
  if (captures.length === 0) return false;
  return captures.every((reference) => {
    const symbol = reference.resolvedSymbol;
    const declaration = symbol?.declarationNode;
    const statement = declaration?.parent;
    if (
      !symbol ||
      symbol.kind !== "const" ||
      !isReadonlyBinding(symbol, scopes) ||
      !isNodeOfType(declaration, "VariableDeclarator") ||
      !isNodeOfType(declaration.id, "ArrayPattern") ||
      !isNodeOfType(statement, "VariableDeclaration") ||
      statement.kind !== "const" ||
      statement.parent !== hookBody ||
      declaration.range[0] >= arrow.range[0] ||
      !isNodeOfType(declaration.init, "CallExpression") ||
      declaration.init.optional
    )
      return false;
    const [, setter] = declaration.id.elements;
    const invocation = reference.identifier.parent;
    return (
      setter === symbol.bindingIdentifier &&
      isNodeOfType(invocation, "CallExpression") &&
      invocation.callee === reference.identifier &&
      !invocation.optional &&
      isUnmodifiedLocalReactStateCall(declaration.init, scopes, { hookName })
    );
  });
};

export const getStableImportedHookMemberKeys = ({
  symbol,
  scopes,
  filename,
}: ImportedHookMemberOptions): ReadonlySet<string> | null => {
  const declaration = symbol.declarationNode;
  const isDestructuredCallback =
    isNodeOfType(declaration, "VariableDeclarator") &&
    isNodeOfType(declaration.id, "ObjectPattern");
  let selectedPropertyName: string | null = null;
  let selectedBindingKey: EsTreeNode | null = null;
  const projectedKeys = new Set<string>();
  if (
    isDestructuredCallback &&
    isNodeOfType(declaration, "VariableDeclarator") &&
    isNodeOfType(declaration.id, "ObjectPattern")
  ) {
    for (const property of declaration.id.properties) {
      if (
        !isNodeOfType(property, "Property") ||
        property.kind !== "init" ||
        property.method ||
        property.computed ||
        !isNodeOfType(property.value, "Identifier")
      )
        return null;
      const name = getStaticPropertyKeyName(property);
      if (!name || name === "__proto__" || projectedKeys.has(name)) return null;
      projectedKeys.add(name);
      if (property.value === symbol.bindingIdentifier) {
        selectedPropertyName = getDestructuredBindingPropertyName(symbol.bindingIdentifier);
        selectedBindingKey = property.key;
      }
    }
    if (!selectedPropertyName) return null;
  }
  const hookName = isDestructuredCallback ? "useReducer" : "useState";
  const statement = declaration.parent;
  const consumerBody = statement?.parent;
  const consumerFunction = consumerBody?.parent;
  const consumerName = consumerFunction ? getFunctionBindingName(consumerFunction) : null;
  if (
    !filename ||
    symbol.kind !== "const" ||
    !isReadonlyBinding(symbol, scopes) ||
    !isNodeOfType(declaration, "VariableDeclarator") ||
    (!isDestructuredCallback && declaration.id !== symbol.bindingIdentifier) ||
    !isNodeOfType(statement, "VariableDeclaration") ||
    statement.kind !== "const" ||
    !isNodeOfType(consumerBody, "BlockStatement") ||
    !isFunctionLike(consumerFunction) ||
    consumerFunction.body !== consumerBody ||
    consumerFunction.async ||
    ((isNodeOfType(consumerFunction, "FunctionDeclaration") ||
      isNodeOfType(consumerFunction, "FunctionExpression")) &&
      consumerFunction.generator) ||
    !consumerName ||
    !isReactComponentOrHookName(consumerName) ||
    !isNodeOfType(declaration.init, "CallExpression") ||
    declaration.init.optional ||
    !isNodeOfType(declaration.init.callee, "Identifier")
  )
    return null;
  const hookSymbol = scopes.symbolFor(declaration.init.callee);
  const specifier = hookSymbol?.declarationNode;
  const imported = hookSymbol ? getImportDeclarationForSymbol(hookSymbol) : null;
  if (
    !hookSymbol ||
    !isReadonlyBinding(hookSymbol, scopes) ||
    !isNodeOfType(specifier, "ImportSpecifier") ||
    specifier.importKind === "type" ||
    !isNodeOfType(specifier.imported, "Identifier") ||
    specifier.imported.name !== specifier.local.name ||
    !HOOK_NAME_PATTERN.test(specifier.imported.name) ||
    !imported ||
    imported.importKind === "type" ||
    typeof imported.source.value !== "string" ||
    !(imported.source.value.startsWith("./") || imported.source.value.startsWith("../")) ||
    !hookSymbol.references.every((reference) => {
      const invocation = reference.identifier.parent;
      return (
        isNodeOfType(invocation, "CallExpression") &&
        invocation.callee === reference.identifier &&
        !invocation.optional
      );
    })
  )
    return null;
  const hasProviderHazardIn = (
    providerScopes: ScopeAnalysis,
    rejectGlobalRequire = true,
  ): boolean => {
    if (hasReactDefaultProviderMutation(hookName, providerScopes)) return true;
    let hasProviderHazard = false;
    walkAst(providerScopes.rootScope.node, (node) => {
      if (hasProviderHazard) return false;
      if (
        (rejectGlobalRequire &&
          isProvenGlobalNamespaceReference(node, "require", providerScopes)) ||
        isProvenGlobalNamespaceReference(node, "eval", providerScopes)
      ) {
        hasProviderHazard = true;
        return false;
      }
      const dependency =
        getRuntimeStaticDependencySource(node) ??
        getGlobalRequireModuleSource(node, providerScopes);
      if (
        dependency === "module" ||
        dependency === "node:module" ||
        dependency === "vm" ||
        dependency === "node:vm"
      ) {
        hasProviderHazard = true;
        return false;
      }
      if (!isDestructuredCallback) return;
      if (
        isNodeOfType(node, "WithStatement") ||
        isNodeOfType(node, "ImportExpression") ||
        isProvenGlobalNamespaceReference(node, "module", providerScopes) ||
        isProvenGlobalNamespaceReference(node, "Function", providerScopes) ||
        isProvenGlobalNamespaceReference(node, "Object", providerScopes) ||
        isProvenGlobalNamespaceReference(node, "Reflect", providerScopes) ||
        (isNodeOfType(node, "MemberExpression") &&
          isMemberMutationTarget(node) &&
          getResolvedStaticPropertyName(node, providerScopes) === hookName)
      ) {
        hasProviderHazard = true;
        return false;
      }
    });
    return hasProviderHazard;
  };
  if (hasProviderHazardIn(scopes)) return null;
  const resolved = resolveCrossFileFunctionExportWithFilePath(
    filename,
    imported.source.value,
    specifier.imported.name,
    isDestructuredCallback ? { requireCompleteReexports: true } : {},
  );
  if (
    !resolved ||
    (!isDestructuredCallback &&
      resolved.filePath !== resolveModulePath(filename, imported.source.value)) ||
    (!isNodeOfType(resolved.functionNode, "ArrowFunctionExpression") &&
      !isNodeOfType(resolved.functionNode, "FunctionDeclaration")) ||
    resolved.functionNode.async ||
    (isNodeOfType(resolved.functionNode, "FunctionDeclaration") &&
      resolved.functionNode.generator) ||
    !isNodeOfType(resolved.functionNode.body, "BlockStatement")
  )
    return null;
  if (isDestructuredCallback) {
    if (!resolved.contexts || resolved.contexts.length === 0) return null;
    const tracedFiles = new Set(resolved.contexts.map((context) => context.filePath));
    for (const context of resolved.contexts) {
      if (
        !isNodeOfType(context.programNode, "Program") ||
        !hasUnaliasedReactStateProviderConfiguration(context.filePath, true)
      )
        return null;
      if (
        context.role === "forwarder" &&
        !context.programNode.body.every(
          (statement) =>
            (isNodeOfType(statement, "ExportAllDeclaration") &&
              typeof statement.source.value === "string") ||
            (isNodeOfType(statement, "ExportNamedDeclaration") &&
              (statement.exportKind === "type" ||
                (statement.source &&
                  !statement.declaration &&
                  typeof statement.source.value === "string"))),
        )
      )
        return null;
      for (const statement of context.programNode.body) {
        if (
          (isNodeOfType(statement, "ExportAllDeclaration") ||
            isNodeOfType(statement, "ExportNamedDeclaration")) &&
          statement.exportKind !== "type" &&
          statement.source &&
          typeof statement.source.value === "string"
        ) {
          const target = resolveModulePath(context.filePath, statement.source.value);
          if (!target || !tracedFiles.has(target)) return null;
        }
      }
      let contextScopes = scopesByProgram.get(context.programNode);
      if (!contextScopes) {
        contextScopes = analyzeScopes(context.programNode);
        scopesByProgram.set(context.programNode, contextScopes);
      }
      if (hasProviderHazardIn(contextScopes)) return null;
    }
  }
  let producerScopes = scopesByProgram.get(resolved.programNode);
  if (!producerScopes) {
    producerScopes = analyzeScopes(resolved.programNode);
    scopesByProgram.set(resolved.programNode, producerScopes);
  }
  if (!isDestructuredCallback && hasProviderHazardIn(producerScopes, false)) return null;
  const [producerSymbol, ...otherBindings] = getFunctionBindingSymbols(
    resolved.functionNode,
    producerScopes,
  );
  const producerDeclaration = producerSymbol?.declarationNode;
  const exportDeclaration = isNodeOfType(producerDeclaration, "VariableDeclarator")
    ? producerDeclaration.parent?.parent
    : producerDeclaration?.parent;
  if (
    !producerSymbol ||
    otherBindings.length > 0 ||
    producerSymbol.name !== specifier.imported.name ||
    producerSymbol.scope.kind !== "module" ||
    !isReadonlyBinding(producerSymbol, producerScopes) ||
    !isNodeOfType(exportDeclaration, "ExportNamedDeclaration") ||
    exportDeclaration.parent !== resolved.programNode ||
    (isNodeOfType(producerDeclaration, "VariableDeclarator") &&
      (!isNodeOfType(producerDeclaration.parent, "VariableDeclaration") ||
        producerDeclaration.parent.kind !== "const")) ||
    !hasUnaliasedReactStateProviderConfiguration(filename, isDestructuredCallback) ||
    !hasUnaliasedReactStateProviderConfiguration(resolved.filePath, isDestructuredCallback)
  )
    return null;
  const body = resolved.functionNode.body;
  const [returned, ...otherReturns] = collectFunctionReturnStatements(resolved.functionNode);
  if (
    !returned ||
    otherReturns.length > 0 ||
    body.body.at(-1) !== returned ||
    !isNodeOfType(returned.argument, "ObjectExpression")
  )
    return null;
  const methods = new Map<string, EsTreeNodeOfType<"ArrowFunctionExpression">>();
  const returnedKeys = new Set<string>();
  for (const property of returned.argument.properties) {
    if (
      !isNodeOfType(property, "Property") ||
      property.kind !== "init" ||
      property.method ||
      property.computed
    )
      return null;
    const name = getStaticPropertyKeyName(property);
    if (!name || name === "__proto__" || returnedKeys.has(name)) return null;
    returnedKeys.add(name);
    if (isDestructuredCallback && name !== selectedPropertyName) continue;
    const arrow = getReturnedArrow(property.value, body, producerScopes);
    if (!arrow) return null;
    methods.set(name, arrow);
  }
  if (isDestructuredCallback) {
    if ([...projectedKeys].some((key) => !returnedKeys.has(key))) return null;
    if (
      !symbol.references.every((reference) => {
        if (reference.identifier === selectedBindingKey) return true;
        const invocation = reference.identifier.parent;
        return (
          isNodeOfType(invocation, "CallExpression") &&
          invocation.callee === reference.identifier &&
          !invocation.optional
        );
      })
    )
      return null;
    const arrow = selectedPropertyName ? methods.get(selectedPropertyName) : null;
    return arrow && capturesOnlyOwnedStateSetters(arrow, body, producerScopes, hookName)
      ? new Set([symbol.name])
      : null;
  }
  if (
    !symbol.references.every((reference) => {
      const member = reference.identifier.parent;
      if (
        !isNodeOfType(member, "MemberExpression") ||
        member.object !== reference.identifier ||
        member.optional ||
        member.computed ||
        isMemberMutationTarget(member)
      )
        return false;
      const invocation = member.parent;
      const name = getStaticPropertyName(member);
      return (
        name !== null &&
        methods.has(name) &&
        isNodeOfType(invocation, "CallExpression") &&
        invocation.callee === member &&
        !invocation.optional
      );
    })
  )
    return null;
  const keys = new Set<string>();
  for (const [name, arrow] of methods) {
    if (capturesOnlyOwnedStateSetters(arrow, body, producerScopes))
      keys.add(`${symbol.name}.${name}`);
  }
  return keys;
};
