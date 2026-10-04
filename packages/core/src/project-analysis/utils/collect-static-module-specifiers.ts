import { parseSync } from "oxc-parser";
import { isOxcAstNode } from "./oxc-ast-node.js";

interface CollectStaticModuleSpecifiersOptions {
  filePath?: string;
  includeTypeOnly?: boolean;
}

const getStaticModuleSpecifier = (value: unknown): string | undefined => {
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

export const collectStaticModuleSpecifiers = (
  sourceText: string,
  options: CollectStaticModuleSpecifiersOptions = {},
): Set<string> => {
  const { filePath = "module.tsx", includeTypeOnly = true } = options;
  const parsedModule = parseSync(filePath, sourceText, { sourceType: "unambiguous" });
  const moduleSpecifiers = new Set<string>();

  const addSpecifier = (value: unknown): void => {
    const moduleSpecifier = getStaticModuleSpecifier(value);
    if (moduleSpecifier) moduleSpecifiers.add(moduleSpecifier);
  };

  const visitNode = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const child of value) visitNode(child);
      return;
    }
    if (!isOxcAstNode(value)) return;

    if (value.type === "ImportDeclaration") {
      const specifiers = Array.isArray(value.specifiers) ? value.specifiers : [];
      const hasRuntimeSpecifier = specifiers.some(
        (specifier) => !isOxcAstNode(specifier) || specifier.importKind !== "type",
      );
      if (
        includeTypeOnly ||
        (value.importKind !== "type" && (specifiers.length === 0 || hasRuntimeSpecifier))
      ) {
        addSpecifier(value.source);
      }
    } else if (value.type === "ExportNamedDeclaration") {
      const specifiers = Array.isArray(value.specifiers) ? value.specifiers : [];
      const hasRuntimeSpecifier = specifiers.some(
        (specifier) => !isOxcAstNode(specifier) || specifier.exportKind !== "type",
      );
      if (
        includeTypeOnly ||
        (value.exportKind !== "type" && (specifiers.length === 0 || hasRuntimeSpecifier))
      ) {
        addSpecifier(value.source);
      }
    } else if (value.type === "ExportAllDeclaration" || value.type === "ImportExpression") {
      if (includeTypeOnly || value.exportKind !== "type") addSpecifier(value.source);
    } else if (value.type === "TSImportType") {
      if (includeTypeOnly) addSpecifier(value.source);
    } else if (value.type === "TSExternalModuleReference") {
      addSpecifier(value.expression);
    } else if (
      value.type === "CallExpression" &&
      isOxcAstNode(value.callee) &&
      value.callee.type === "Identifier" &&
      value.callee.name === "require" &&
      Array.isArray(value.arguments) &&
      value.arguments.length > 0
    ) {
      addSpecifier(value.arguments[0]);
    }

    for (const child of Object.values(value)) visitNode(child);
  };

  visitNode(parsedModule.program);
  return moduleSpecifiers;
};
