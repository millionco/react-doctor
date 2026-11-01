import type { EsTreeNode } from "./es-tree-node.js";
import type { ClosedJsonSnapshotModule } from "./get-closed-json-snapshot-project.js";
import { getFunctionExportNames } from "./get-function-export-names.js";
import { getClassBindingSymbol } from "./get-class-binding-symbol.js";
import { getModuleSpecifierName } from "./get-module-specifier-name.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const getClosedJsonSnapshotComponentExportNames = (
  module: ClosedJsonSnapshotModule,
  component: EsTreeNode,
): ReadonlyArray<string> => {
  if (!isNodeOfType(module.program, "Program")) return [];
  const names = new Set(getFunctionExportNames(module.program, component));
  if (!isNodeOfType(component, "ClassDeclaration")) return [...names];
  const binding = getClassBindingSymbol(component, module.scopes);
  if (!binding) return [...names];
  for (const statement of module.program.body) {
    if (
      isNodeOfType(statement, "ExportDefaultDeclaration") &&
      isNodeOfType(statement.declaration, "Identifier") &&
      statement.declaration.name === binding.name
    )
      names.add("default");
    if (!isNodeOfType(statement, "ExportNamedDeclaration") || statement.source) continue;
    if (statement.declaration === component) names.add(binding.name);
    for (const specifier of statement.specifiers) {
      if (
        !isNodeOfType(specifier, "ExportSpecifier") ||
        getModuleSpecifierName(specifier.local) !== binding.name
      )
        continue;
      const name = getModuleSpecifierName(specifier.exported);
      if (name) names.add(name);
    }
  }
  return [...names];
};
