import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getStaticKeyName } from "./get-static-key-name.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { isNodeOfType } from "./is-node-of-type.js";

export interface QueryClientOptionsImport {
  readonly source: string;
  readonly importedName: string;
  readonly localName: string;
}

export interface ImmutableQueryClientExport {
  readonly localName: string;
  readonly optionsImport: QueryClientOptionsImport | null;
}

// AST evidence only. The caller separately qualifies the canonical package's
// QueryClient constructor and the optional relative options module. No import,
// constructor, configuration or provider source is executed by this predicate.
export const readImmutableQueryClientExport = (
  program: EsTreeNode,
  scopes: ScopeAnalysis,
  exportedName: string,
): ImmutableQueryClientExport | null => {
  if (!isNodeOfType(program, "Program") || scopes.rootScope.node !== program) return null;
  const statements = program.body;
  const constructorImport = statements[0];
  if (
    !isNodeOfType(constructorImport, "ImportDeclaration") ||
    constructorImport.importKind === "type" ||
    constructorImport.attributes?.length ||
    constructorImport.source.value !== "@tanstack/react-query" ||
    constructorImport.specifiers.length !== 1
  )
    return null;
  const [constructorSpecifier] = constructorImport.specifiers;
  if (
    !isNodeOfType(constructorSpecifier, "ImportSpecifier") ||
    constructorSpecifier.importKind === "type" ||
    !isNodeOfType(constructorSpecifier.imported, "Identifier") ||
    constructorSpecifier.imported.name !== "QueryClient"
  )
    return null;
  const constructor = scopes.symbolFor(constructorSpecifier.local);
  if (constructor?.kind !== "import" || constructor.declarationNode !== constructorSpecifier)
    return null;

  let declarationIndex = 1;
  let options: QueryClientOptionsImport | null = null;
  let optionsSymbol: SymbolDescriptor | null = null;
  const possibleOptions = statements[1];
  if (isNodeOfType(possibleOptions, "ImportDeclaration")) {
    const source = possibleOptions.source.value;
    if (
      possibleOptions.importKind === "type" ||
      possibleOptions.attributes?.length ||
      typeof source !== "string" ||
      !/^\.\.?\//.test(source) ||
      /[\\?#\u0000]/.test(source) ||
      possibleOptions.specifiers.length !== 1
    )
      return null;
    const [specifier] = possibleOptions.specifiers;
    if (
      !isNodeOfType(specifier, "ImportSpecifier") ||
      specifier.importKind === "type" ||
      !isNodeOfType(specifier.imported, "Identifier")
    )
      return null;
    optionsSymbol = scopes.symbolFor(specifier.local);
    if (optionsSymbol?.kind !== "import" || optionsSymbol.declarationNode !== specifier)
      return null;
    options = { source, importedName: specifier.imported.name, localName: specifier.local.name };
    declarationIndex++;
  }

  const statement = statements[declarationIndex];
  const exportedDeclaration = isNodeOfType(statement, "ExportNamedDeclaration") ? statement : null;
  const declaration = exportedDeclaration ? exportedDeclaration.declaration : statement;
  if (
    exportedDeclaration &&
    (exportedDeclaration.source ||
      exportedDeclaration.exportKind === "type" ||
      exportedDeclaration.specifiers.length !== 0)
  )
    return null;
  if (
    !isNodeOfType(declaration, "VariableDeclaration") ||
    declaration.kind !== "const" ||
    declaration.declarations.length !== 1
  )
    return null;
  const [variable] = declaration.declarations;
  if (
    !isNodeOfType(variable.id, "Identifier") ||
    !isNodeOfType(variable.init, "NewExpression") ||
    !isNodeOfType(variable.init.callee, "Identifier") ||
    scopes.symbolFor(variable.init.callee) !== constructor ||
    variable.init.arguments.length > 1
  )
    return null;
  const binding = scopes.symbolFor(variable.id);
  if (binding?.kind !== "const" || binding.declarationNode !== variable) return null;
  let exportReference: EsTreeNode | null = null;
  if (exportedDeclaration) {
    if (statements.length !== declarationIndex + 1 || variable.id.name !== exportedName)
      return null;
  } else {
    const exported = statements[declarationIndex + 1];
    if (
      statements.length !== declarationIndex + 2 ||
      !isNodeOfType(exported, "ExportNamedDeclaration") ||
      exported.source ||
      exported.declaration ||
      exported.exportKind === "type" ||
      exported.specifiers.length !== 1
    )
      return null;
    const [specifier] = exported.specifiers;
    if (
      !isNodeOfType(specifier, "ExportSpecifier") ||
      specifier.exportKind === "type" ||
      !isNodeOfType(specifier.exported, "Identifier") ||
      specifier.exported.name !== exportedName ||
      !isNodeOfType(specifier.local, "Identifier") ||
      scopes.symbolFor(specifier.local) !== binding
    )
      return null;
    exportReference = specifier.local;
  }

  const optionsReferences = new Set<EsTreeNode>();
  const isPlainArgument = (node: EsTreeNode): boolean => {
    if (isNodeOfType(node, "Literal")) return !("regex" in node);
    if (isNodeOfType(node, "Identifier")) {
      if (!optionsSymbol || scopes.symbolFor(node) !== optionsSymbol) return false;
      optionsReferences.add(node);
      return true;
    }
    if (!isNodeOfType(node, "ObjectExpression")) return false;
    const keys = new Set<string>();
    return node.properties.every((property) => {
      if (
        !isNodeOfType(property, "Property") ||
        property.kind !== "init" ||
        property.method ||
        property.computed
      )
        return false;
      const key = getStaticKeyName(property.key);
      if (key === null || keys.has(key) || ["__proto__", "constructor", "prototype"].includes(key))
        return false;
      keys.add(key);
      return isPlainArgument(property.value);
    });
  };
  if (!variable.init.arguments.every(isPlainArgument)) return null;
  const hasOnlyReferences = (
    symbol: SymbolDescriptor,
    permitted: ReadonlySet<EsTreeNode>,
  ): boolean => {
    const references = symbol.references.filter(
      ({ identifier }) => identifier !== symbol.bindingIdentifier,
    );
    return (
      references.length === permitted.size &&
      references.every(({ flag, identifier }) => flag === "read" && permitted.has(identifier)) &&
      hasCompleteSymbolReferences(symbol, program, scopes)
    );
  };
  if (
    !hasOnlyReferences(constructor, new Set([variable.init.callee])) ||
    !hasOnlyReferences(binding, new Set(exportReference ? [exportReference] : [])) ||
    (optionsSymbol &&
      (optionsReferences.size === 0 || !hasOnlyReferences(optionsSymbol, optionsReferences)))
  )
    return null;
  return { localName: variable.id.name, optionsImport: options };
};
