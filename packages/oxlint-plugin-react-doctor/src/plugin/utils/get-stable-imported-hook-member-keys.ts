import { hasStandardReactJsxConfiguration } from "./resolve-tsconfig-alias.js";
import { resolveWebpackAliasPath } from "./resolve-webpack-alias-path.js";
import { HOOK_NAME_PATTERN } from "../constants/react.js";
import { closureCaptures } from "../semantic/closure-captures.js";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import { collectFunctionReturnStatements } from "./collect-function-return-statements.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getFunctionBindingSymbols } from "./get-function-binding-symbols.js";
import { isProvenGlobalNamespaceReference } from "./is-proven-global-namespace-reference.js";
import { getFunctionBindingName } from "./get-function-binding-name.js";
import { getImportDeclarationForSymbol } from "./get-import-declaration-for-symbol.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { hasReactDefaultProviderMutation } from "./has-react-default-provider-mutation.js";
import { hasSymbolBindingWrites } from "./has-symbol-binding-writes.js";
import { isMemberMutationTarget } from "./is-member-mutation-target.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNonReferenceIdentifier } from "./is-non-reference-identifier.js";
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

const hasUnaliasedReactStateProviderConfiguration = (filename: string): boolean =>
  hasStandardReactJsxConfiguration(filename, { requireUnaliasedReact: true }) &&
  !resolveWebpackAliasPath(filename, "react")?.declared &&
  !resolveModulePath(filename, "react");

const isReadonlyBinding = (symbol: SymbolDescriptor, scopes: ScopeAnalysis): boolean =>
  !hasSymbolBindingWrites(symbol) &&
  hasCompleteSymbolReferences(symbol, scopes.rootScope.node, scopes);

const hasLexicalReceiverReference = (arrow: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  let hasReceiver = false;
  walkAst(arrow, (node) => {
    if (hasReceiver) return false;
    if (node !== arrow && isFunctionLike(node) && !isNodeOfType(node, "ArrowFunctionExpression"))
      return false;
    if (
      isNodeOfType(node, "ThisExpression") ||
      isNodeOfType(node, "Super") ||
      isNodeOfType(node, "MetaProperty") ||
      (isNodeOfType(node, "Identifier") &&
        node.name === "arguments" &&
        !isNonReferenceIdentifier(node) &&
        Boolean(scopes.referenceFor(node)) &&
        scopes.isGlobalReference(node))
    ) {
      hasReceiver = true;
      return false;
    }
  });
  return hasReceiver;
};

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
      isUnmodifiedLocalReactStateCall(declaration.init, scopes)
    );
  });
};

export const getStableImportedHookMemberKeys = ({
  symbol,
  scopes,
  filename,
}: ImportedHookMemberOptions): ReadonlySet<string> | null => {
  const declaration = symbol.declarationNode;
  const statement = declaration.parent;
  const consumerBody = statement?.parent;
  const consumerFunction = consumerBody?.parent;
  const consumerName = consumerFunction ? getFunctionBindingName(consumerFunction) : null;
  if (
    !filename ||
    symbol.kind !== "const" ||
    !isReadonlyBinding(symbol, scopes) ||
    !isNodeOfType(declaration, "VariableDeclarator") ||
    declaration.id !== symbol.bindingIdentifier ||
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
  if (hasReactDefaultProviderMutation("useState", scopes)) return null;
  let hasCommonJsLoader = false;
  walkAst(scopes.rootScope.node, (node) => {
    if (hasCommonJsLoader) return false;
    if (isProvenGlobalNamespaceReference(node, "require", scopes)) {
      hasCommonJsLoader = true;
      return false;
    }
  });
  if (hasCommonJsLoader) return null;
  const resolved = resolveCrossFileFunctionExportWithFilePath(
    filename,
    imported.source.value,
    specifier.imported.name,
  );
  if (
    !resolved ||
    resolved.filePath !== resolveModulePath(filename, imported.source.value) ||
    (!isNodeOfType(resolved.functionNode, "ArrowFunctionExpression") &&
      !isNodeOfType(resolved.functionNode, "FunctionDeclaration")) ||
    resolved.functionNode.async ||
    (isNodeOfType(resolved.functionNode, "FunctionDeclaration") &&
      resolved.functionNode.generator) ||
    !isNodeOfType(resolved.functionNode.body, "BlockStatement")
  )
    return null;
  let producerScopes = scopesByProgram.get(resolved.programNode);
  if (!producerScopes) {
    producerScopes = analyzeScopes(resolved.programNode);
    scopesByProgram.set(resolved.programNode, producerScopes);
  }
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
    !hasUnaliasedReactStateProviderConfiguration(filename) ||
    !hasUnaliasedReactStateProviderConfiguration(resolved.filePath)
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
  for (const property of returned.argument.properties) {
    if (
      !isNodeOfType(property, "Property") ||
      property.kind !== "init" ||
      property.method ||
      property.computed
    )
      return null;
    const name = getStaticPropertyKeyName(property);
    const arrow = getReturnedArrow(property.value, body, producerScopes);
    if (!name || name === "__proto__" || methods.has(name) || !arrow) return null;
    methods.set(name, arrow);
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
