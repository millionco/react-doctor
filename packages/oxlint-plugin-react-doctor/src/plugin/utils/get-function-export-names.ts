import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getDirectFunctionBindingIdentifier } from "./get-direct-function-binding-identifier.js";
import { getModuleSpecifierName } from "./get-module-specifier-name.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const getFunctionExportNames = (
  programNode: EsTreeNodeOfType<"Program">,
  functionNode: EsTreeNode,
): ReadonlyArray<string> => {
  const functionValueRoot = findTransparentExpressionRoot(functionNode);
  const bindingIdentifier = getDirectFunctionBindingIdentifier(functionNode);
  const bindingName = bindingIdentifier?.name ?? null;
  const exportedNames = new Set<string>();

  for (const statement of programNode.body) {
    if (isNodeOfType(statement, "ExportDefaultDeclaration")) {
      if (
        statement.declaration === functionValueRoot ||
        (bindingName &&
          isNodeOfType(statement.declaration, "Identifier") &&
          statement.declaration.name === bindingName)
      ) {
        exportedNames.add("default");
      }
      continue;
    }
    if (!isNodeOfType(statement, "ExportNamedDeclaration")) continue;
    const declaration = statement.declaration;
    if (declaration === functionValueRoot && bindingName) exportedNames.add(bindingName);
    if (declaration && isNodeOfType(declaration, "VariableDeclaration")) {
      for (const declarator of declaration.declarations) {
        if (declarator.init === functionValueRoot && isNodeOfType(declarator.id, "Identifier")) {
          exportedNames.add(declarator.id.name);
        }
      }
    }
    if (!bindingName || statement.source) continue;
    for (const specifier of statement.specifiers) {
      if (!isNodeOfType(specifier, "ExportSpecifier")) continue;
      if (getModuleSpecifierName(specifier.local) !== bindingName) continue;
      const exportedName = getModuleSpecifierName(specifier.exported);
      if (exportedName) exportedNames.add(exportedName);
    }
  }

  return [...exportedNames];
};
