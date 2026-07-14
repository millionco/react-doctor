import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export const findExportedValue = (
  programRoot: EsTreeNode,
  exportedName: string,
): EsTreeNode | null => {
  if (!isNodeOfType(programRoot, "Program")) return null;

  const localBindings = new Map<string, EsTreeNode>();
  const namedExports = new Map<string, string>();
  let defaultExport: EsTreeNode | null = null;
  let defaultExportIdentifierName: string | null = null;

  const recordVariableDeclaration = (
    declaration: EsTreeNodeOfType<"VariableDeclaration">,
  ): void => {
    for (const declarator of declaration.declarations ?? []) {
      if (!isNodeOfType(declarator, "VariableDeclarator")) continue;
      if (!isNodeOfType(declarator.id, "Identifier") || !declarator.init) continue;
      localBindings.set(declarator.id.name, stripParenExpression(declarator.init));
    }
  };

  for (const statement of programRoot.body ?? []) {
    if (isNodeOfType(statement, "VariableDeclaration")) {
      recordVariableDeclaration(statement);
      continue;
    }
    if (isNodeOfType(statement, "FunctionDeclaration") && statement.id) {
      localBindings.set(statement.id.name, statement);
      continue;
    }
    if (isNodeOfType(statement, "ExportNamedDeclaration")) {
      if (statement.exportKind === "type") continue;
      const declaration = statement.declaration;
      if (declaration && isNodeOfType(declaration, "VariableDeclaration")) {
        recordVariableDeclaration(declaration);
        for (const declarator of declaration.declarations ?? []) {
          if (!isNodeOfType(declarator, "VariableDeclarator")) continue;
          if (!isNodeOfType(declarator.id, "Identifier")) continue;
          namedExports.set(declarator.id.name, declarator.id.name);
        }
      } else if (
        declaration &&
        isNodeOfType(declaration, "FunctionDeclaration") &&
        declaration.id
      ) {
        localBindings.set(declaration.id.name, declaration);
        namedExports.set(declaration.id.name, declaration.id.name);
      }
      for (const specifier of statement.specifiers ?? []) {
        if (!isNodeOfType(specifier, "ExportSpecifier") || specifier.exportKind === "type") {
          continue;
        }
        const localName = isNodeOfType(specifier.local, "Identifier") ? specifier.local.name : null;
        let exportedSpecifierName: string | null = null;
        if (isNodeOfType(specifier.exported, "Identifier")) {
          exportedSpecifierName = specifier.exported.name;
        } else if (
          isNodeOfType(specifier.exported, "Literal") &&
          typeof specifier.exported.value === "string"
        ) {
          exportedSpecifierName = specifier.exported.value;
        }
        if (localName && exportedSpecifierName) {
          namedExports.set(exportedSpecifierName, localName);
        }
      }
      continue;
    }
    if (!isNodeOfType(statement, "ExportDefaultDeclaration")) continue;
    const declaration = statement.declaration;
    if (!declaration) continue;
    if (isNodeOfType(declaration, "Identifier")) {
      defaultExportIdentifierName = declaration.name;
    } else {
      if (
        (isNodeOfType(declaration, "FunctionDeclaration") ||
          isNodeOfType(declaration, "ClassDeclaration")) &&
        declaration.id
      ) {
        localBindings.set(declaration.id.name, declaration);
      }
      defaultExport = stripParenExpression(declaration);
    }
  }

  if (exportedName === "default") {
    if (defaultExport) return defaultExport;
    if (defaultExportIdentifierName) {
      const binding = localBindings.get(defaultExportIdentifierName);
      if (binding) return binding;
    }
  }
  const localName = namedExports.get(exportedName);
  return localName ? (localBindings.get(localName) ?? null) : null;
};
