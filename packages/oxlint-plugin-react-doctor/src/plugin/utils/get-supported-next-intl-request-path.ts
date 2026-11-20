import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

// The caller supplies this version only after canonical package/export resolution
// and integrity qualification. A declared package.json range is not sufficient.
// This checks a config AST shape; it never executes Next or the plugin. The
// caller still owns request-path existence and compiler-resolution probes.
export const getSupportedNextIntlRequestPath = (
  program: EsTreeNode,
  scopes: ScopeAnalysis,
  qualifiedPluginVersion: string | null,
): string | null => {
  if (
    qualifiedPluginVersion !== "4.0.2" ||
    !isNodeOfType(program, "Program") ||
    scopes.rootScope.node !== program
  )
    return null;
  const statements = program.body;
  const typeImport = statements[0];
  let runtimeStart = 0;
  if (isNodeOfType(typeImport, "ImportDeclaration") && typeImport.source.value === "next") {
    if (typeImport.specifiers.length !== 1) return null;
    const [specifier] = typeImport.specifiers;
    if (
      !isNodeOfType(specifier, "ImportSpecifier") ||
      (typeImport.importKind !== "type" && specifier.importKind !== "type") ||
      !isNodeOfType(specifier.imported, "Identifier") ||
      specifier.imported.name !== "NextConfig"
    )
      return null;
    runtimeStart = 1;
  }
  if (statements.length !== runtimeStart + 4) return null;
  const [pluginImport, wrapperStatement, configStatement, exported] =
    statements.slice(runtimeStart);
  if (
    !isNodeOfType(pluginImport, "ImportDeclaration") ||
    pluginImport.importKind === "type" ||
    pluginImport.source.value !== "next-intl/plugin" ||
    pluginImport.specifiers.length !== 1
  )
    return null;
  const [pluginSpecifier] = pluginImport.specifiers;
  if (!isNodeOfType(pluginSpecifier, "ImportDefaultSpecifier")) return null;
  if (
    !isNodeOfType(wrapperStatement, "VariableDeclaration") ||
    wrapperStatement.kind !== "const" ||
    wrapperStatement.declarations.length !== 1 ||
    !isNodeOfType(configStatement, "VariableDeclaration") ||
    configStatement.kind !== "const" ||
    configStatement.declarations.length !== 1
  )
    return null;
  const [wrapper] = wrapperStatement.declarations;
  const [config] = configStatement.declarations;
  if (
    !isNodeOfType(wrapper.id, "Identifier") ||
    !wrapper.init ||
    !isNodeOfType(config.id, "Identifier") ||
    !config.init ||
    !isNodeOfType(exported, "ExportDefaultDeclaration")
  )
    return null;
  const pluginCall = stripParenExpression(wrapper.init);
  const configValue = stripParenExpression(config.init);
  const exportCall = stripParenExpression(exported.declaration);
  if (
    !isNodeOfType(pluginCall, "CallExpression") ||
    pluginCall.optional ||
    !isNodeOfType(pluginCall.callee, "Identifier") ||
    pluginCall.arguments.length !== 1 ||
    !isNodeOfType(configValue, "ObjectExpression") ||
    configValue.properties.length !== 1 ||
    !isNodeOfType(exportCall, "CallExpression") ||
    exportCall.optional ||
    !isNodeOfType(exportCall.callee, "Identifier") ||
    exportCall.arguments.length !== 1
  )
    return null;
  const [requestPath] = pluginCall.arguments;
  const [output] = configValue.properties;
  const [exportArgument] = exportCall.arguments;
  if (
    !isNodeOfType(requestPath, "Literal") ||
    typeof requestPath.value !== "string" ||
    !/^\.\.?\//.test(requestPath.value) ||
    /[\\?#\u0000]/.test(requestPath.value) ||
    !isNodeOfType(output, "Property") ||
    output.kind !== "init" ||
    output.method ||
    output.computed ||
    !isNodeOfType(output.key, "Identifier") ||
    output.key.name !== "output" ||
    !isNodeOfType(output.value, "Literal") ||
    output.value.value !== "standalone" ||
    !isNodeOfType(exportArgument, "Identifier")
  )
    return null;
  const plugin = scopes.symbolFor(pluginSpecifier.local);
  const wrapperBinding = scopes.symbolFor(wrapper.id);
  const configBinding = scopes.symbolFor(config.id);
  const onlyReference = (symbol: SymbolDescriptor | null, expected: EsTreeNode): boolean =>
    Boolean(
      symbol &&
      symbol.references.length === 1 &&
      symbol.references[0].flag === "read" &&
      symbol.references[0].identifier === expected &&
      hasCompleteSymbolReferences(symbol, program, scopes),
    );
  return plugin?.kind === "import" &&
    plugin.declarationNode === pluginSpecifier &&
    wrapperBinding?.kind === "const" &&
    wrapperBinding.declarationNode === wrapper &&
    configBinding?.kind === "const" &&
    configBinding.declarationNode === config &&
    scopes.symbolFor(pluginCall.callee) === plugin &&
    scopes.symbolFor(exportCall.callee) === wrapperBinding &&
    scopes.symbolFor(exportArgument) === configBinding &&
    onlyReference(plugin, pluginCall.callee) &&
    onlyReference(wrapperBinding, exportCall.callee) &&
    onlyReference(configBinding, exportArgument)
    ? requestPath.value
    : null;
};
