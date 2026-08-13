import { dirname, resolve } from "node:path";
import { parseSync } from "oxc-parser";
import { getIdentifierName, isOxcAstNode, type OxcAstNode } from "./oxc-ast-node.js";

const TRANSPARENT_EXPRESSION_TYPES = new Set([
  "ChainExpression",
  "ParenthesizedExpression",
  "TSAsExpression",
  "TSInstantiationExpression",
  "TSNonNullExpression",
  "TSSatisfiesExpression",
  "TSTypeAssertion",
]);

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

const collectVariableInitializers = (
  statements: unknown[],
  inheritedInitializers: ReadonlyMap<string, OxcAstNode> = new Map(),
): Map<string, OxcAstNode> => {
  const variableInitializers = new Map(inheritedInitializers);
  for (const statement of statements) {
    if (!isOxcAstNode(statement) || statement.type !== "VariableDeclaration") continue;
    const declarations = Array.isArray(statement.declarations) ? statement.declarations : [];
    for (const declaration of declarations) {
      if (!isOxcAstNode(declaration)) continue;
      const variableName = getIdentifierName(declaration.id);
      if (variableName && isOxcAstNode(declaration.init)) {
        variableInitializers.set(variableName, declaration.init);
      }
    }
  }
  return variableInitializers;
};

const isStaticObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const evaluateExpression = (
  expression: unknown,
  variableInitializers: ReadonlyMap<string, OxcAstNode>,
  configDirectory: string,
  visitedIdentifiers = new Set<string>(),
): unknown => {
  if (!isOxcAstNode(expression)) return undefined;
  if (TRANSPARENT_EXPRESSION_TYPES.has(expression.type)) {
    return evaluateExpression(
      expression.expression,
      variableInitializers,
      configDirectory,
      visitedIdentifiers,
    );
  }
  if (expression.type === "Literal") return expression.value;
  if (expression.type === "TemplateLiteral") {
    const expressions = Array.isArray(expression.expressions) ? expression.expressions : [];
    const quasis = Array.isArray(expression.quasis) ? expression.quasis : [];
    if (expressions.length > 0 || quasis.length !== 1 || !isOxcAstNode(quasis[0])) return undefined;
    const quasiValue = quasis[0].value;
    if (typeof quasiValue !== "object" || quasiValue === null) return undefined;
    const cookedValue = Object.entries(quasiValue).find(([key]) => key === "cooked")?.[1];
    return typeof cookedValue === "string" ? cookedValue : undefined;
  }
  if (expression.type === "Identifier") {
    const identifierName = getIdentifierName(expression);
    if (identifierName === "__dirname") return configDirectory;
    if (!identifierName || visitedIdentifiers.has(identifierName)) return undefined;
    const initializer = variableInitializers.get(identifierName);
    if (!initializer) return undefined;
    return evaluateExpression(
      initializer,
      variableInitializers,
      configDirectory,
      new Set(visitedIdentifiers).add(identifierName),
    );
  }
  if (expression.type === "ArrayExpression") {
    const values: unknown[] = [];
    const elements = Array.isArray(expression.elements) ? expression.elements : [];
    for (const element of elements) {
      if (!isOxcAstNode(element)) continue;
      if (element.type === "SpreadElement") {
        const spreadValue = evaluateExpression(
          element.argument,
          variableInitializers,
          configDirectory,
          visitedIdentifiers,
        );
        if (Array.isArray(spreadValue)) values.push(...spreadValue);
        continue;
      }
      const value = evaluateExpression(
        element,
        variableInitializers,
        configDirectory,
        visitedIdentifiers,
      );
      if (value !== undefined) values.push(value);
    }
    return values;
  }
  if (expression.type === "ObjectExpression") {
    const entries: [string, unknown][] = [];
    const properties = Array.isArray(expression.properties) ? expression.properties : [];
    for (const property of properties) {
      if (!isOxcAstNode(property)) continue;
      if (property.type === "SpreadElement") {
        const spreadValue = evaluateExpression(
          property.argument,
          variableInitializers,
          configDirectory,
          visitedIdentifiers,
        );
        if (isStaticObject(spreadValue)) entries.push(...Object.entries(spreadValue));
        continue;
      }
      const propertyName = getPropertyName(property);
      if (!propertyName) continue;
      const propertyValue = evaluateExpression(
        property.value,
        variableInitializers,
        configDirectory,
        visitedIdentifiers,
      );
      if (propertyValue !== undefined) entries.push([propertyName, propertyValue]);
    }
    return Object.fromEntries(entries);
  }
  if (expression.type === "BinaryExpression" && expression.operator === "+") {
    const leftValue = evaluateExpression(
      expression.left,
      variableInitializers,
      configDirectory,
      visitedIdentifiers,
    );
    const rightValue = evaluateExpression(
      expression.right,
      variableInitializers,
      configDirectory,
      visitedIdentifiers,
    );
    return typeof leftValue === "string" && typeof rightValue === "string"
      ? leftValue + rightValue
      : undefined;
  }
  if (
    expression.type === "ArrowFunctionExpression" ||
    expression.type === "FunctionExpression" ||
    expression.type === "FunctionDeclaration"
  ) {
    if (!isOxcAstNode(expression.body)) return undefined;
    if (expression.body.type !== "BlockStatement") {
      return evaluateExpression(
        expression.body,
        variableInitializers,
        configDirectory,
        visitedIdentifiers,
      );
    }
    const statements = Array.isArray(expression.body.body) ? expression.body.body : [];
    const callbackInitializers = collectVariableInitializers(statements, variableInitializers);
    const returnStatement = statements.find(
      (statement) => isOxcAstNode(statement) && statement.type === "ReturnStatement",
    );
    return isOxcAstNode(returnStatement)
      ? evaluateExpression(
          returnStatement.argument,
          callbackInitializers,
          configDirectory,
          visitedIdentifiers,
        )
      : undefined;
  }
  if (expression.type === "MemberExpression") {
    const objectValue = evaluateExpression(
      expression.object,
      variableInitializers,
      configDirectory,
      visitedIdentifiers,
    );
    const propertyName = getIdentifierName(expression.property);
    return isStaticObject(objectValue) && propertyName ? objectValue[propertyName] : undefined;
  }
  if (expression.type !== "CallExpression" || !isOxcAstNode(expression.callee)) return undefined;
  const argumentsList = Array.isArray(expression.arguments) ? expression.arguments : [];
  const calleeName = getIdentifierName(expression.callee);
  if (
    calleeName &&
    ["defineConfig", "defineProject", "defineWorkspace", "freeze"].includes(calleeName)
  ) {
    return evaluateExpression(
      argumentsList[0],
      variableInitializers,
      configDirectory,
      visitedIdentifiers,
    );
  }
  const memberCallee = expression.callee;
  const memberObjectName = getIdentifierName(memberCallee.object);
  const memberPropertyName = getIdentifierName(memberCallee.property);
  if (memberObjectName === "Object" && memberPropertyName === "freeze") {
    return evaluateExpression(
      argumentsList[0],
      variableInitializers,
      configDirectory,
      visitedIdentifiers,
    );
  }
  const isPathCall =
    ["join", "resolve"].includes(calleeName ?? "") ||
    (memberObjectName === "path" && ["join", "resolve"].includes(memberPropertyName ?? ""));
  if (isPathCall) {
    const pathSegments = argumentsList.map((argument) =>
      evaluateExpression(argument, variableInitializers, configDirectory, visitedIdentifiers),
    );
    return pathSegments.every((segment) => typeof segment === "string")
      ? resolve(...pathSegments)
      : undefined;
  }
  if (calleeName === "fileURLToPath" && isOxcAstNode(argumentsList[0])) {
    const urlExpression = argumentsList[0];
    if (
      urlExpression.type === "NewExpression" &&
      getIdentifierName(urlExpression.callee) === "URL" &&
      Array.isArray(urlExpression.arguments)
    ) {
      const relativePath = evaluateExpression(
        urlExpression.arguments[0],
        variableInitializers,
        configDirectory,
        visitedIdentifiers,
      );
      return typeof relativePath === "string" ? resolve(configDirectory, relativePath) : undefined;
    }
  }
  return undefined;
};

export const evaluateStaticConfig = (content: string, configPath: string): unknown => {
  let parsedModule: ReturnType<typeof parseSync>;
  try {
    parsedModule = parseSync(configPath, content, { sourceType: "unambiguous" });
  } catch {
    return undefined;
  }
  if (parsedModule.errors.some((error) => error.severity === "Error")) return undefined;
  const statements = parsedModule.program.body;
  const variableInitializers = collectVariableInitializers(statements);
  for (const statement of statements) {
    if (!isOxcAstNode(statement)) continue;
    if (statement.type === "ExportDefaultDeclaration") {
      return evaluateExpression(statement.declaration, variableInitializers, dirname(configPath));
    }
    if (statement.type !== "ExpressionStatement" || !isOxcAstNode(statement.expression)) continue;
    const expression = statement.expression;
    if (
      expression.type === "AssignmentExpression" &&
      expression.operator === "=" &&
      isOxcAstNode(expression.left) &&
      expression.left.type === "MemberExpression" &&
      getIdentifierName(expression.left.object) === "module" &&
      getIdentifierName(expression.left.property) === "exports"
    ) {
      return evaluateExpression(expression.right, variableInitializers, dirname(configPath));
    }
  }
  const expressionStatement = statements.find(
    (statement) => isOxcAstNode(statement) && statement.type === "ExpressionStatement",
  );
  return isOxcAstNode(expressionStatement)
    ? evaluateExpression(expressionStatement.expression, variableInitializers, dirname(configPath))
    : undefined;
};
