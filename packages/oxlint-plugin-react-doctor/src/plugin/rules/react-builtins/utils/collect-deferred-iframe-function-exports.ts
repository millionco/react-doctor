import type { SourceProjectModule } from "../../../utils/build-source-project-index.js";
import type { SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { getDirectFunctionBindingIdentifier } from "../../../utils/get-direct-function-binding-identifier.js";
import { getModuleSpecifierName } from "../../../utils/get-module-specifier-name.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";

export const collectDeferredIframeFunctionExports = (
  module: SourceProjectModule,
): ReadonlyMap<EsTreeNode, ReadonlySet<string>> => {
  const functionsBySymbol = new Map<SymbolDescriptor, EsTreeNode | null>();
  const exportsByFunction = new Map<EsTreeNode, Set<string>>();
  const registerFunction = (value: EsTreeNode) => {
    const functionNode = stripParenExpression(value);
    if (!isFunctionLike(functionNode)) return;
    const binding = getDirectFunctionBindingIdentifier(functionNode);
    const symbol = binding && module.scopes.symbolFor(binding);
    if (symbol) functionsBySymbol.set(symbol, functionsBySymbol.has(symbol) ? null : functionNode);
  };
  for (const statement of module.programNode.body) {
    const declaration =
      isNodeOfType(statement, "ExportNamedDeclaration") ||
      isNodeOfType(statement, "ExportDefaultDeclaration")
        ? statement.declaration
        : statement;
    if (!declaration) continue;
    if (isNodeOfType(declaration, "VariableDeclaration")) {
      for (const declarator of declaration.declarations)
        if (declarator.init) registerFunction(declarator.init);
    } else registerFunction(declaration);
  }
  const addExport = (value: EsTreeNode, exportedName: string | null) => {
    if (!exportedName) return;
    const expression = stripParenExpression(value);
    const symbol = isNodeOfType(expression, "Identifier")
      ? module.scopes.symbolFor(expression)
      : null;
    let functionNode: EsTreeNode | null | undefined = null;
    if (symbol) functionNode = functionsBySymbol.get(symbol);
    else if (isFunctionLike(expression)) functionNode = expression;
    if (!functionNode) return;
    const names = exportsByFunction.get(functionNode) ?? new Set<string>();
    names.add(exportedName);
    exportsByFunction.set(functionNode, names);
  };
  for (const statement of module.programNode.body) {
    if (isNodeOfType(statement, "ExportDefaultDeclaration")) {
      addExport(statement.declaration, "default");
    } else if (
      isNodeOfType(statement, "ExportNamedDeclaration") &&
      statement.exportKind !== "type" &&
      !statement.source
    ) {
      const declaration = statement.declaration;
      if (declaration && isNodeOfType(declaration, "VariableDeclaration")) {
        for (const declarator of declaration.declarations)
          if (isNodeOfType(declarator.id, "Identifier"))
            addExport(declarator.id, declarator.id.name);
      } else if (declaration && isFunctionLike(declaration)) {
        const binding = getDirectFunctionBindingIdentifier(declaration);
        if (binding) addExport(binding, binding.name);
      }
      for (const specifier of statement.specifiers)
        if (isNodeOfType(specifier, "ExportSpecifier") && specifier.exportKind !== "type")
          addExport(specifier.local, getModuleSpecifierName(specifier.exported));
    }
  }
  return exportsByFunction;
};
