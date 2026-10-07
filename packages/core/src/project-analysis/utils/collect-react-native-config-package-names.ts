import { parseSync } from "oxc-parser";
import { getIdentifierName, isOxcAstNode, type OxcAstNode } from "./oxc-ast-node.js";

const getPropertyName = (property: OxcAstNode): string | undefined => {
  if (property.type !== "Property" || property.computed === true || !isOxcAstNode(property.key)) {
    return undefined;
  }
  return (
    getIdentifierName(property.key) ??
    (property.key.type === "Literal" && typeof property.key.value === "string"
      ? property.key.value
      : undefined)
  );
};

const getObjectPropertyValue = (
  objectExpression: OxcAstNode,
  propertyName: string,
): OxcAstNode | undefined => {
  if (objectExpression.type !== "ObjectExpression" || !Array.isArray(objectExpression.properties)) {
    return undefined;
  }
  for (const property of objectExpression.properties) {
    if (!isOxcAstNode(property) || getPropertyName(property) !== propertyName) continue;
    return isOxcAstNode(property.value) ? property.value : undefined;
  }
  return undefined;
};

const getExportedConfigObject = (statement: OxcAstNode): OxcAstNode | undefined => {
  if (
    statement.type === "ExportDefaultDeclaration" &&
    isOxcAstNode(statement.declaration) &&
    statement.declaration.type === "ObjectExpression"
  ) {
    return statement.declaration;
  }
  if (statement.type !== "ExpressionStatement" || !isOxcAstNode(statement.expression)) {
    return undefined;
  }
  const assignment = statement.expression;
  if (
    assignment.type !== "AssignmentExpression" ||
    assignment.operator !== "=" ||
    !isOxcAstNode(assignment.left) ||
    !isOxcAstNode(assignment.right) ||
    assignment.right.type !== "ObjectExpression"
  ) {
    return undefined;
  }
  const target = assignment.left;
  if (
    target.type !== "MemberExpression" ||
    target.computed === true ||
    !isOxcAstNode(target.object) ||
    !isOxcAstNode(target.property) ||
    getIdentifierName(target.object) !== "module" ||
    getIdentifierName(target.property) !== "exports"
  ) {
    return undefined;
  }
  return assignment.right;
};

export const collectReactNativeConfigPackageNames = (
  content: string,
  declaredPackageNames: ReadonlySet<string>,
): Set<string> => {
  let parsedModule: ReturnType<typeof parseSync>;
  try {
    parsedModule = parseSync("react-native.config.ts", content, { sourceType: "unambiguous" });
  } catch {
    return new Set();
  }
  if (parsedModule.errors.some((error) => error.severity === "Error")) return new Set();

  const packageNames = new Set<string>();
  for (const statement of parsedModule.program.body) {
    if (!isOxcAstNode(statement)) continue;
    const configObject = getExportedConfigObject(statement);
    if (!configObject) continue;
    const dependencies = getObjectPropertyValue(configObject, "dependencies");
    if (
      !dependencies ||
      dependencies.type !== "ObjectExpression" ||
      !Array.isArray(dependencies.properties)
    ) {
      continue;
    }
    for (const property of dependencies.properties) {
      if (!isOxcAstNode(property)) continue;
      const packageName = getPropertyName(property);
      if (packageName && declaredPackageNames.has(packageName)) packageNames.add(packageName);
    }
  }
  return packageNames;
};
