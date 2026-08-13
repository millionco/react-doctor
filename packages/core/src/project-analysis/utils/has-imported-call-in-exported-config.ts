import { parseSync } from "oxc-parser";
import { getIdentifierName, isOxcAstNode } from "./oxc-ast-node.js";

const FUNCTION_NODE_TYPES = new Set([
  "ArrowFunctionExpression",
  "FunctionDeclaration",
  "FunctionExpression",
]);

export const hasImportedCallInExportedConfig = (
  content: string,
  moduleName: string,
  exportName: string,
): boolean => {
  let parsedModule: ReturnType<typeof parseSync>;
  try {
    parsedModule = parseSync("project.config.ts", content, { sourceType: "module" });
  } catch {
    return false;
  }
  if (parsedModule.errors.some((error) => error.severity === "Error")) return false;

  const importedIdentifiers = new Set<string>();
  const namespaceIdentifiers = new Set<string>();
  for (const statement of parsedModule.program.body) {
    if (statement.type !== "ImportDeclaration" || statement.source.value !== moduleName) continue;
    for (const specifier of statement.specifiers) {
      if (
        specifier.type === "ImportSpecifier" &&
        getIdentifierName(specifier.imported) === exportName
      ) {
        importedIdentifiers.add(specifier.local.name);
      }
      if (specifier.type === "ImportNamespaceSpecifier") {
        namespaceIdentifiers.add(specifier.local.name);
      }
    }
  }
  if (importedIdentifiers.size === 0 && namespaceIdentifiers.size === 0) return false;

  let hasImportedCall = false;
  const visitNode = (value: unknown): void => {
    if (hasImportedCall || !isOxcAstNode(value) || FUNCTION_NODE_TYPES.has(value.type)) return;
    if (value.type === "CallExpression" && isOxcAstNode(value.callee)) {
      const directCalleeName = getIdentifierName(value.callee);
      if (directCalleeName && importedIdentifiers.has(directCalleeName)) {
        hasImportedCall = true;
        return;
      }
      if (value.callee.type === "StaticMemberExpression") {
        const namespaceName = getIdentifierName(value.callee.object);
        if (
          namespaceName &&
          namespaceIdentifiers.has(namespaceName) &&
          getIdentifierName(value.callee.property) === exportName
        ) {
          hasImportedCall = true;
          return;
        }
      }
    }
    for (const child of Object.values(value)) {
      if (Array.isArray(child)) {
        for (const element of child) visitNode(element);
      } else {
        visitNode(child);
      }
    }
  };

  for (const statement of parsedModule.program.body) {
    if (statement.type === "ExportDefaultDeclaration") {
      visitNode(statement.declaration);
      continue;
    }
    if (statement.type !== "ExportNamedDeclaration" || !statement.declaration) continue;
    if (statement.declaration.type !== "VariableDeclaration") continue;
    for (const declaration of statement.declaration.declarations) {
      if (getIdentifierName(declaration.id) === "config") visitNode(declaration.init);
    }
  }
  return hasImportedCall;
};
