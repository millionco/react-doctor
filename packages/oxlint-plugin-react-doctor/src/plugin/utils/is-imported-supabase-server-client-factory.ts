import { analyzeScopes } from "../semantic/scope-analysis.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getFunctionBindingSymbols } from "./get-function-binding-symbols.js";
import { getImportDeclarationForSymbol } from "./get-import-declaration-for-symbol.js";
import { getImportedName } from "./get-imported-name.js";
import { getSingleReturnExpression } from "./get-single-return-expression.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isTypeScriptTypePosition } from "./is-typescript-type-position.js";
import { isWithinAssignmentTarget } from "./is-within-assignment-target.js";
import { resolveCrossFileFunctionExportWithFilePath } from "./resolve-cross-file-function-export.js";
import { resolveModulePath } from "./resolve-module-path.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

export interface SupabaseServerClientFactoryContext {
  readonly filename?: string;
  readonly scopes: ScopeAnalysis;
}

interface DirectImportedApiBinding {
  readonly symbol: SymbolDescriptor;
  readonly source: string;
  readonly importedName: string;
}

const hasOnlyReferences = (
  symbol: SymbolDescriptor | null,
  identifiers: readonly EsTreeNode[],
  scopes: ScopeAnalysis,
): boolean => {
  if (!symbol) return false;
  const references = symbol.references.filter(
    (reference) => !isTypeScriptTypePosition(reference.identifier),
  );
  return (
    references.length === identifiers.length &&
    references.every(
      (reference) =>
        reference.flag === "read" &&
        !isWithinAssignmentTarget(reference.identifier) &&
        identifiers.includes(reference.identifier),
    ) &&
    hasCompleteSymbolReferences(symbol, scopes.rootScope.node, scopes)
  );
};

const getDirectImport = (
  identifier: EsTreeNode,
  scopes: ScopeAnalysis,
): DirectImportedApiBinding | null => {
  if (!isNodeOfType(identifier, "Identifier")) return null;
  const symbol = scopes.symbolFor(identifier);
  if (symbol?.kind !== "import") return null;
  const declaration = getImportDeclarationForSymbol(symbol);
  const specifier = symbol.declarationNode;
  if (
    !declaration ||
    declaration.importKind === "type" ||
    typeof declaration.source.value !== "string"
  )
    return null;
  if (isNodeOfType(specifier, "ImportDefaultSpecifier")) {
    return { symbol, source: declaration.source.value, importedName: "default" };
  }
  if (!isNodeOfType(specifier, "ImportSpecifier") || specifier.importKind === "type") return null;
  const importedName = getImportedName(specifier);
  return importedName ? { symbol, source: declaration.source.value, importedName } : null;
};

const isNamedApiCall = (
  call: EsTreeNode,
  source: string,
  importedName: string,
  filename: string,
  scopes: ScopeAnalysis,
): boolean => {
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    !isNodeOfType(call.callee, "Identifier")
  )
    return false;
  const imported = getDirectImport(call.callee, scopes);
  return Boolean(
    imported &&
    imported.source === source &&
    imported.importedName === importedName &&
    isNodeOfType(imported.symbol.declarationNode, "ImportSpecifier") &&
    hasOnlyReferences(imported.symbol, [call.callee], scopes) &&
    !resolveModulePath(filename, source),
  );
};

const getOnlyPropertyValue = (expression: EsTreeNode, name: string): EsTreeNode | null => {
  const object = stripParenExpression(expression);
  if (!isNodeOfType(object, "ObjectExpression")) return null;
  const [property, ...remaining] = object.properties;
  if (
    remaining.length ||
    !isNodeOfType(property, "Property") ||
    property.computed ||
    property.kind !== "init" ||
    property.shorthand ||
    !isNodeOfType(property.key, "Identifier") ||
    property.key.name !== name
  )
    return null;
  return property.value;
};

const isEnvironmentRead = (expression: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const property = stripParenExpression(expression);
  if (
    !isNodeOfType(property, "MemberExpression") ||
    property.optional ||
    property.computed ||
    !isNodeOfType(property.property, "Identifier")
  )
    return false;
  const environment = stripParenExpression(property.object);
  return (
    isNodeOfType(environment, "MemberExpression") &&
    !environment.optional &&
    !environment.computed &&
    isNodeOfType(environment.property, "Identifier") &&
    environment.property.name === "env" &&
    isNodeOfType(environment.object, "Identifier") &&
    environment.object.name === "process" &&
    scopes.isGlobalReference(environment.object)
  );
};

const hasCookieAdapter = (
  options: EsTreeNode,
  cookieParameter: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const cookieOptions = getOnlyPropertyValue(options, "cookies");
  if (!cookieOptions) return false;
  const getter = getOnlyPropertyValue(cookieOptions, "get");
  if (
    (!isNodeOfType(getter, "FunctionExpression") &&
      !isNodeOfType(getter, "ArrowFunctionExpression")) ||
    getter.async ||
    getter.generator
  )
    return false;
  const [nameParameter, ...extraParameters] = getter.params;
  if (!isNodeOfType(nameParameter, "Identifier") || extraParameters.length) return false;
  const returned = getSingleReturnExpression(getter);
  if (!returned) return false;
  const value = stripParenExpression(returned);
  if (
    !isNodeOfType(value, "MemberExpression") ||
    value.computed ||
    !value.optional ||
    !isNodeOfType(value.property, "Identifier") ||
    value.property.name !== "value"
  )
    return false;
  const readCookie = stripParenExpression(value.object);
  if (!isNodeOfType(readCookie, "CallExpression") || readCookie.optional) return false;
  const receiver = readCookie.callee;
  const [argument, ...extraArguments] = readCookie.arguments;
  if (
    !isNodeOfType(receiver, "MemberExpression") ||
    receiver.optional ||
    receiver.computed ||
    !isNodeOfType(receiver.property, "Identifier") ||
    receiver.property.name !== "get" ||
    !isNodeOfType(receiver.object, "Identifier") ||
    !isNodeOfType(argument, "Identifier") ||
    extraArguments.length ||
    scopes.symbolFor(receiver.object) !== scopes.symbolFor(cookieParameter) ||
    scopes.symbolFor(argument) !== scopes.symbolFor(nameParameter)
  )
    return false;
  return (
    hasOnlyReferences(scopes.symbolFor(cookieParameter), [receiver.object], scopes) &&
    hasOnlyReferences(scopes.symbolFor(nameParameter), [argument], scopes)
  );
};

const isSelectedDeclaration = (statement: EsTreeNode, functionNode: EsTreeNode): boolean => {
  if (statement === functionNode) return isNodeOfType(functionNode, "FunctionDeclaration");
  if (!isNodeOfType(statement, "VariableDeclaration") || statement.kind !== "const") return false;
  const [declarator, ...extraDeclarations] = statement.declarations;
  return (
    !extraDeclarations.length &&
    isNodeOfType(declarator, "VariableDeclarator") &&
    isNodeOfType(declarator.id, "Identifier") &&
    declarator.init !== null &&
    stripParenExpression(declarator.init) === functionNode &&
    isNodeOfType(functionNode, "ArrowFunctionExpression")
  );
};

const hasOnlyProviderDeclarations = (
  program: EsTreeNode,
  functionNode: EsTreeNode,
  exportedName: string,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isNodeOfType(program, "Program")) return false;
  const bindings = getFunctionBindingSymbols(functionNode, scopes);
  if (!bindings.length) return false;
  const exportIdentifiers: EsTreeNode[] = [];
  let hasSelectedExport = false;
  for (const statement of program.body) {
    if (
      isNodeOfType(statement, "ImportDeclaration") ||
      isNodeOfType(statement, "TSInterfaceDeclaration") ||
      isNodeOfType(statement, "TSTypeAliasDeclaration")
    )
      continue;
    if (isSelectedDeclaration(statement, functionNode)) continue;
    if (isNodeOfType(statement, "ExportDefaultDeclaration") && exportedName === "default") {
      if (statement.declaration === functionNode) {
        hasSelectedExport = true;
        continue;
      }
      if (
        isNodeOfType(statement.declaration, "Identifier") &&
        bindings.some((binding) => binding === scopes.symbolFor(statement.declaration))
      ) {
        exportIdentifiers.push(statement.declaration);
        hasSelectedExport = true;
        continue;
      }
      return false;
    }
    if (!isNodeOfType(statement, "ExportNamedDeclaration") || statement.source) return false;
    const declaration = statement.declaration;
    if (
      declaration &&
      (isNodeOfType(declaration, "TSInterfaceDeclaration") ||
        isNodeOfType(declaration, "TSTypeAliasDeclaration"))
    )
      continue;
    if (
      declaration &&
      isSelectedDeclaration(declaration, functionNode) &&
      bindings.some((binding) => binding.name === exportedName)
    ) {
      hasSelectedExport = true;
      continue;
    }
    if (declaration || statement.exportKind === "type") return false;
    const [specifier, ...extraSpecifiers] = statement.specifiers;
    if (
      extraSpecifiers.length ||
      !isNodeOfType(specifier, "ExportSpecifier") ||
      specifier.exportKind === "type" ||
      !isNodeOfType(specifier.local, "Identifier") ||
      !isNodeOfType(specifier.exported, "Identifier") ||
      specifier.exported.name !== exportedName ||
      !bindings.some((binding) => binding === scopes.symbolFor(specifier.local))
    )
      return false;
    exportIdentifiers.push(specifier.local);
    hasSelectedExport = true;
  }
  return (
    hasSelectedExport &&
    bindings.every((binding) =>
      hasOnlyReferences(
        binding,
        exportIdentifiers.filter((identifier) => scopes.symbolFor(identifier) === binding),
        scopes,
      ),
    )
  );
};

export const isImportedSupabaseServerClientFactory = (
  call: EsTreeNode,
  { filename, scopes }: SupabaseServerClientFactoryContext,
): boolean => {
  if (
    !filename ||
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    !isNodeOfType(call.callee, "Identifier")
  )
    return false;
  const [cookieArgument, ...extraArguments] = call.arguments;
  if (!isNodeOfType(cookieArgument, "Identifier") || extraArguments.length) return false;
  const imported = getDirectImport(call.callee, scopes);
  if (!imported) return false;
  const cookieStore = scopes.symbolFor(cookieArgument);
  if (
    cookieStore?.kind !== "const" ||
    !isNodeOfType(cookieStore.declarationNode, "VariableDeclarator") ||
    !isNodeOfType(cookieStore.declarationNode.id, "Identifier") ||
    !isNodeOfType(cookieStore.declarationNode.parent, "VariableDeclaration") ||
    isNodeOfType(cookieStore.declarationNode.parent.parent, "ExportNamedDeclaration") ||
    !cookieStore.initializer
  )
    return false;
  const initializer = stripParenExpression(cookieStore.initializer);
  if (
    !isNamedApiCall(initializer, "next/headers", "cookies", filename, scopes) ||
    !isNodeOfType(initializer, "CallExpression") ||
    initializer.arguments.length ||
    !hasOnlyReferences(imported.symbol, [call.callee], scopes) ||
    !hasOnlyReferences(cookieStore, [cookieArgument], scopes)
  )
    return false;
  let hasDynamicScope = false;
  walkAst(scopes.rootScope.node, (node) => {
    if (hasDynamicScope) return false;
    if (isNodeOfType(node, "WithStatement")) {
      hasDynamicScope = true;
      return false;
    }
    if (!isNodeOfType(node, "CallExpression")) return;
    const callee = stripParenExpression(node.callee);
    if (isNodeOfType(callee, "Identifier") && callee.name === "eval") {
      hasDynamicScope = true;
      return false;
    }
  });
  if (hasDynamicScope) return false;
  const immediatePath = resolveModulePath(filename, imported.source);
  if (!immediatePath) return false;
  const resolved = resolveCrossFileFunctionExportWithFilePath(
    filename,
    imported.source,
    imported.importedName,
  );
  if (!resolved || resolved.filePath !== immediatePath) return false;
  const functionNode = resolved.functionNode;
  if (
    (!isNodeOfType(functionNode, "FunctionDeclaration") &&
      !isNodeOfType(functionNode, "ArrowFunctionExpression")) ||
    functionNode.async ||
    functionNode.generator
  )
    return false;
  const [cookieParameter, ...extraParameters] = functionNode.params;
  if (!isNodeOfType(cookieParameter, "Identifier") || extraParameters.length) return false;
  const providerScopes = analyzeScopes(resolved.programNode);
  if (
    !hasOnlyProviderDeclarations(
      resolved.programNode,
      functionNode,
      imported.importedName,
      providerScopes,
    )
  )
    return false;
  const returned = getSingleReturnExpression(functionNode);
  if (!returned) return false;
  const constructorCall = stripParenExpression(returned);
  if (
    !isNamedApiCall(
      constructorCall,
      "@supabase/ssr",
      "createServerClient",
      resolved.filePath,
      providerScopes,
    ) ||
    !isNodeOfType(constructorCall, "CallExpression")
  )
    return false;
  const [url, key, options, ...extraOptions] = constructorCall.arguments;
  return Boolean(
    url &&
    key &&
    options &&
    !extraOptions.length &&
    isEnvironmentRead(url, providerScopes) &&
    isEnvironmentRead(key, providerScopes) &&
    hasCookieAdapter(options, cookieParameter, providerScopes),
  );
};
