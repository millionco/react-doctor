import { parseSync } from "oxc-parser";
import { isOxcAstNode } from "./oxc-ast-node.js";
import { extractPackageName } from "./package-name.js";

export const collectStaticModulePackageNames = (sourceText: string): Set<string> => {
  const parsedModule = parseSync("package-reference.tsx", sourceText, { sourceType: "module" });

  const packageNames = new Set<string>();
  const addSpecifier = (specifier: string): void => {
    const packageName = extractPackageName(specifier);
    if (packageName) packageNames.add(packageName);
  };
  const getStaticSpecifier = (value: unknown): string | undefined => {
    if (!isOxcAstNode(value)) return undefined;
    if (typeof value.value === "string") return value.value;
    if (
      value.type === "TemplateLiteral" &&
      Array.isArray(value.expressions) &&
      value.expressions.length === 0 &&
      Array.isArray(value.quasis) &&
      isOxcAstNode(value.quasis[0]) &&
      value.quasis[0].value &&
      typeof value.quasis[0].value === "object" &&
      "cooked" in value.quasis[0].value &&
      typeof value.quasis[0].value.cooked === "string"
    ) {
      return value.quasis[0].value.cooked;
    }
    return undefined;
  };
  for (const staticImport of parsedModule.module.staticImports) {
    addSpecifier(staticImport.moduleRequest.value);
  }
  for (const staticExport of parsedModule.module.staticExports) {
    for (const entry of staticExport.entries) {
      if (entry.moduleRequest) addSpecifier(entry.moduleRequest.value);
    }
  }

  const visitNode = (value: unknown, isInTypeScriptModuleBlock = false): void => {
    if (Array.isArray(value)) {
      for (const child of value) visitNode(child, isInTypeScriptModuleBlock);
      return;
    }
    if (!isOxcAstNode(value)) return;
    if (
      isInTypeScriptModuleBlock &&
      (value.type === "ImportDeclaration" ||
        value.type === "ExportNamedDeclaration" ||
        value.type === "ExportAllDeclaration")
    ) {
      const sourceValue = getStaticSpecifier(value.source);
      if (sourceValue) addSpecifier(sourceValue);
    }
    if (value.type === "ImportExpression" || value.type === "TSImportType") {
      const sourceValue = getStaticSpecifier(value.source);
      if (sourceValue) addSpecifier(sourceValue);
    }
    if (value.type === "TSExternalModuleReference") {
      const expressionValue = getStaticSpecifier(value.expression);
      if (expressionValue) addSpecifier(expressionValue);
    }
    if (
      value.type === "CallExpression" &&
      isOxcAstNode(value.callee) &&
      value.callee.type === "Identifier" &&
      value.callee.name === "require" &&
      Array.isArray(value.arguments) &&
      value.arguments.length > 0
    ) {
      const argumentValue = getStaticSpecifier(value.arguments[0]);
      if (argumentValue) addSpecifier(argumentValue);
    }
    const childIsInTypeScriptModuleBlock =
      isInTypeScriptModuleBlock || value.type === "TSModuleBlock";
    for (const child of Object.values(value)) {
      visitNode(child, childIsInTypeScriptModuleBlock);
    }
  };
  visitNode(parsedModule.program);
  return packageNames;
};
