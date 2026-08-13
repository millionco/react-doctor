import { parseSync } from "oxc-parser";
import { extractDefaultExportLocalName } from "./extract-default-export-local-name.js";
import { getIdentifierName, isOxcAstNode, type OxcAstNode } from "./oxc-ast-node.js";

const getPropertyName = (node: unknown): string | undefined => {
  if (!isOxcAstNode(node)) return undefined;
  return getIdentifierName(node) ?? (typeof node.value === "string" ? node.value : undefined);
};

const unwrapExpression = (node: unknown): OxcAstNode | undefined => {
  if (!isOxcAstNode(node)) return undefined;
  if (
    node.type === "TSAsExpression" ||
    node.type === "TSSatisfiesExpression" ||
    node.type === "TSNonNullExpression" ||
    node.type === "ParenthesizedExpression"
  ) {
    return unwrapExpression(node.expression);
  }
  return node;
};

const findObjectPropertyValue = (node: unknown, propertyName: string): unknown => {
  const objectExpression = unwrapExpression(node);
  if (
    objectExpression?.type !== "ObjectExpression" ||
    !Array.isArray(objectExpression.properties)
  ) {
    return undefined;
  }
  for (const property of objectExpression.properties) {
    if (
      isOxcAstNode(property) &&
      property.type === "Property" &&
      getPropertyName(property.key) === propertyName
    ) {
      return property.value;
    }
  }
  return undefined;
};

const isEnabledOptimizeCssConfig = (node: unknown): boolean => {
  const experimentalConfig = findObjectPropertyValue(node, "experimental");
  const optimizeCssValue = unwrapExpression(
    findObjectPropertyValue(experimentalConfig, "optimizeCss"),
  );
  return optimizeCssValue?.type === "Literal" && optimizeCssValue.value === true;
};

export const hasEnabledNextOptimizeCss = (content: string): boolean => {
  let parsedModule: ReturnType<typeof parseSync>;
  try {
    parsedModule = parseSync("next.config.ts", content, { sourceType: "unambiguous" });
  } catch {
    return false;
  }
  if (parsedModule.errors.some((error) => error.severity === "Error")) return false;

  const initializersByName = new Map<string, unknown>();
  for (const statement of parsedModule.program.body) {
    if (statement.type !== "VariableDeclaration") continue;
    for (const declaration of statement.declarations) {
      const declarationName = getIdentifierName(declaration.id);
      if (declarationName) initializersByName.set(declarationName, declaration.init);
    }
  }

  for (const statement of parsedModule.program.body) {
    if (statement.type === "ExportDefaultDeclaration") {
      const localName = extractDefaultExportLocalName(statement.declaration);
      const exportedConfig = localName ? initializersByName.get(localName) : statement.declaration;
      if (isEnabledOptimizeCssConfig(exportedConfig)) return true;
    }
    if (
      statement.type === "ExpressionStatement" &&
      isOxcAstNode(statement.expression) &&
      statement.expression.type === "AssignmentExpression" &&
      isOxcAstNode(statement.expression.left) &&
      statement.expression.left.type === "MemberExpression" &&
      getIdentifierName(statement.expression.left.object) === "module" &&
      getIdentifierName(statement.expression.left.property) === "exports"
    ) {
      const assignedConfig = unwrapExpression(statement.expression.right);
      const localName = getIdentifierName(assignedConfig);
      if (
        isEnabledOptimizeCssConfig(localName ? initializersByName.get(localName) : assignedConfig)
      ) {
        return true;
      }
    }
  }
  return false;
};
