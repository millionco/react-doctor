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

const CONFIG_HELPER_EXPORTS_BY_MODULE = new Map([
  ["tsdown", new Set(["defineConfig"])],
  ["tsup", new Set(["defineConfig"])],
  ["vite", new Set(["defineConfig"])],
  ["vitest/config", new Set(["defineConfig", "defineProject", "defineWorkspace"])],
]);

const PATH_MODULE_NAMES = new Set(["node:path", "path"]);
const URL_MODULE_NAMES = new Set(["node:url", "url"]);

interface StaticConfigBinding {
  kind:
    | "config-namespace"
    | "config-wrapper"
    | "local"
    | "path-function"
    | "path-namespace"
    | "url-function";
  moduleSource?: string;
}

const collectBindingNames = (pattern: unknown, bindingNames: Set<string>): void => {
  if (!isOxcAstNode(pattern)) return;
  const identifierName = getIdentifierName(pattern);
  if (identifierName) {
    bindingNames.add(identifierName);
    return;
  }
  if (pattern.type === "AssignmentPattern") {
    collectBindingNames(pattern.left, bindingNames);
    return;
  }
  if (pattern.type === "RestElement") {
    collectBindingNames(pattern.argument, bindingNames);
    return;
  }
  if (pattern.type === "ArrayPattern") {
    const elements = Array.isArray(pattern.elements) ? pattern.elements : [];
    for (const element of elements) collectBindingNames(element, bindingNames);
    return;
  }
  if (pattern.type !== "ObjectPattern") return;
  const properties = Array.isArray(pattern.properties) ? pattern.properties : [];
  for (const property of properties) {
    if (!isOxcAstNode(property)) continue;
    collectBindingNames(
      property.type === "Property" ? property.value : property.argument,
      bindingNames,
    );
  }
};

const collectStatementBindingNames = (statements: unknown[]): Set<string> => {
  const bindingNames = new Set<string>();
  for (const statementValue of statements) {
    if (!isOxcAstNode(statementValue)) continue;
    const statement =
      statementValue.type === "ExportNamedDeclaration" && isOxcAstNode(statementValue.declaration)
        ? statementValue.declaration
        : statementValue;
    if (statement.type === "VariableDeclaration") {
      const declarations = Array.isArray(statement.declarations) ? statement.declarations : [];
      for (const declaration of declarations) {
        if (isOxcAstNode(declaration)) collectBindingNames(declaration.id, bindingNames);
      }
      continue;
    }
    if (statement.type === "FunctionDeclaration" || statement.type === "ClassDeclaration") {
      collectBindingNames(statement.id, bindingNames);
    }
  }
  return bindingNames;
};

const getLiteralString = (value: unknown): string | undefined =>
  isOxcAstNode(value) && value.type === "Literal" && typeof value.value === "string"
    ? value.value
    : undefined;

const getRequiredModuleSource = (
  expression: unknown,
  hasLocalRequire: boolean,
): string | undefined => {
  if (hasLocalRequire || !isOxcAstNode(expression) || expression.type !== "CallExpression") {
    return undefined;
  }
  if (getIdentifierName(expression.callee) !== "require") return undefined;
  const argumentsList = Array.isArray(expression.arguments) ? expression.arguments : [];
  return getLiteralString(argumentsList[0]);
};

const isApprovedConfigHelper = (moduleSource: string, exportedName: string): boolean =>
  CONFIG_HELPER_EXPORTS_BY_MODULE.get(moduleSource)?.has(exportedName) === true;

const getTrustedImportedBinding = (
  moduleSource: string,
  exportedName: string,
): StaticConfigBinding | undefined => {
  if (isApprovedConfigHelper(moduleSource, exportedName)) {
    return { kind: "config-wrapper" };
  }
  if (PATH_MODULE_NAMES.has(moduleSource) && ["join", "resolve"].includes(exportedName)) {
    return { kind: "path-function" };
  }
  if (URL_MODULE_NAMES.has(moduleSource) && exportedName === "fileURLToPath") {
    return { kind: "url-function" };
  }
  return undefined;
};

const collectStaticConfigBindings = (statements: unknown[]): Map<string, StaticConfigBinding> => {
  const bindings = new Map<string, StaticConfigBinding>();
  for (const bindingName of collectStatementBindingNames(statements)) {
    bindings.set(bindingName, { kind: "local" });
  }

  for (const statement of statements) {
    if (!isOxcAstNode(statement) || statement.type !== "ImportDeclaration") continue;
    const moduleSource = getLiteralString(statement.source);
    if (!moduleSource) continue;
    const specifiers = Array.isArray(statement.specifiers) ? statement.specifiers : [];
    for (const specifier of specifiers) {
      if (!isOxcAstNode(specifier)) continue;
      const localName = getIdentifierName(specifier.local);
      if (!localName) continue;
      bindings.set(localName, { kind: "local" });
      if (specifier.type === "ImportNamespaceSpecifier") {
        if (PATH_MODULE_NAMES.has(moduleSource)) {
          bindings.set(localName, { kind: "path-namespace" });
        } else if (CONFIG_HELPER_EXPORTS_BY_MODULE.has(moduleSource)) {
          bindings.set(localName, { kind: "config-namespace", moduleSource });
        }
        continue;
      }
      if (specifier.type === "ImportDefaultSpecifier") {
        if (PATH_MODULE_NAMES.has(moduleSource)) {
          bindings.set(localName, { kind: "path-namespace" });
        }
        continue;
      }
      if (specifier.type !== "ImportSpecifier") continue;
      const exportedName = getIdentifierName(specifier.imported);
      if (!exportedName) continue;
      const trustedBinding = getTrustedImportedBinding(moduleSource, exportedName);
      if (trustedBinding) bindings.set(localName, trustedBinding);
    }
  }

  const hasLocalRequire = bindings.has("require");
  for (const statement of statements) {
    if (!isOxcAstNode(statement) || statement.type !== "VariableDeclaration") continue;
    const declarations = Array.isArray(statement.declarations) ? statement.declarations : [];
    for (const declaration of declarations) {
      if (!isOxcAstNode(declaration) || !isOxcAstNode(declaration.init)) continue;
      const directModuleSource = getRequiredModuleSource(declaration.init, hasLocalRequire);
      const initializerObject = isOxcAstNode(declaration.init.object)
        ? declaration.init.object
        : undefined;
      const memberModuleSource = getRequiredModuleSource(initializerObject, hasLocalRequire);
      const memberExportedName = getIdentifierName(declaration.init.property);
      const identifierName = getIdentifierName(declaration.id);
      if (identifierName && directModuleSource) {
        if (PATH_MODULE_NAMES.has(directModuleSource)) {
          bindings.set(identifierName, {
            kind: "path-namespace",
          });
        } else if (CONFIG_HELPER_EXPORTS_BY_MODULE.has(directModuleSource)) {
          bindings.set(identifierName, {
            kind: "config-namespace",
            moduleSource: directModuleSource,
          });
        }
        continue;
      }
      if (identifierName && memberModuleSource && memberExportedName) {
        const trustedBinding = getTrustedImportedBinding(memberModuleSource, memberExportedName);
        if (trustedBinding) bindings.set(identifierName, trustedBinding);
        continue;
      }
      if (
        !isOxcAstNode(declaration.id) ||
        declaration.id.type !== "ObjectPattern" ||
        !directModuleSource
      ) {
        continue;
      }
      const properties = Array.isArray(declaration.id.properties) ? declaration.id.properties : [];
      for (const property of properties) {
        if (!isOxcAstNode(property) || property.type !== "Property") continue;
        const exportedName = getIdentifierName(property.key);
        const localName = getIdentifierName(property.value);
        if (!exportedName || !localName) continue;
        const trustedBinding = getTrustedImportedBinding(directModuleSource, exportedName);
        if (trustedBinding) bindings.set(localName, trustedBinding);
      }
    }
  }
  return bindings;
};

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
  bindings: ReadonlyMap<string, StaticConfigBinding>,
  configDirectory: string,
  visitedIdentifiers = new Set<string>(),
): unknown => {
  if (!isOxcAstNode(expression)) return undefined;
  if (TRANSPARENT_EXPRESSION_TYPES.has(expression.type)) {
    return evaluateExpression(
      expression.expression,
      variableInitializers,
      bindings,
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
    if (identifierName === "__dirname" && !bindings.has("__dirname")) return configDirectory;
    if (!identifierName || visitedIdentifiers.has(identifierName)) return undefined;
    const initializer = variableInitializers.get(identifierName);
    if (!initializer) return undefined;
    return evaluateExpression(
      initializer,
      variableInitializers,
      bindings,
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
          bindings,
          configDirectory,
          visitedIdentifiers,
        );
        if (Array.isArray(spreadValue)) values.push(...spreadValue);
        continue;
      }
      const value = evaluateExpression(
        element,
        variableInitializers,
        bindings,
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
          bindings,
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
        bindings,
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
      bindings,
      configDirectory,
      visitedIdentifiers,
    );
    const rightValue = evaluateExpression(
      expression.right,
      variableInitializers,
      bindings,
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
    const functionBindings = new Map(bindings);
    const parameterBindingNames = new Set<string>();
    const parameters = Array.isArray(expression.params) ? expression.params : [];
    for (const parameter of parameters) collectBindingNames(parameter, parameterBindingNames);
    for (const parameterBindingName of parameterBindingNames) {
      functionBindings.set(parameterBindingName, { kind: "local" });
    }
    if (expression.body.type !== "BlockStatement") {
      return evaluateExpression(
        expression.body,
        variableInitializers,
        functionBindings,
        configDirectory,
        visitedIdentifiers,
      );
    }
    const statements = Array.isArray(expression.body.body) ? expression.body.body : [];
    const callbackInitializers = collectVariableInitializers(statements, variableInitializers);
    for (const bindingName of collectStatementBindingNames(statements)) {
      functionBindings.set(bindingName, { kind: "local" });
    }
    const returnStatement = statements.find(
      (statement) => isOxcAstNode(statement) && statement.type === "ReturnStatement",
    );
    return isOxcAstNode(returnStatement)
      ? evaluateExpression(
          returnStatement.argument,
          callbackInitializers,
          functionBindings,
          configDirectory,
          visitedIdentifiers,
        )
      : undefined;
  }
  if (expression.type === "MemberExpression") {
    const objectValue = evaluateExpression(
      expression.object,
      variableInitializers,
      bindings,
      configDirectory,
      visitedIdentifiers,
    );
    const propertyName = getIdentifierName(expression.property);
    return isStaticObject(objectValue) && propertyName ? objectValue[propertyName] : undefined;
  }
  if (expression.type !== "CallExpression" || !isOxcAstNode(expression.callee)) return undefined;
  const argumentsList = Array.isArray(expression.arguments) ? expression.arguments : [];
  const calleeName = getIdentifierName(expression.callee);
  const directBinding = calleeName ? bindings.get(calleeName) : undefined;
  if (directBinding?.kind === "config-wrapper") {
    return evaluateExpression(
      argumentsList[0],
      variableInitializers,
      bindings,
      configDirectory,
      visitedIdentifiers,
    );
  }
  const memberCallee = expression.callee;
  const memberObjectName = getIdentifierName(memberCallee.object);
  const memberPropertyName = getIdentifierName(memberCallee.property);
  const memberObjectBinding = memberObjectName ? bindings.get(memberObjectName) : undefined;
  const isGlobalObjectFreeze =
    memberObjectName === "Object" && memberPropertyName === "freeze" && !memberObjectBinding;
  const isGlobalRequireResolve =
    memberObjectName === "require" && memberPropertyName === "resolve" && !memberObjectBinding;
  const isConfigNamespaceCall =
    memberObjectBinding?.kind === "config-namespace" &&
    typeof memberObjectBinding.moduleSource === "string" &&
    typeof memberPropertyName === "string" &&
    isApprovedConfigHelper(memberObjectBinding.moduleSource, memberPropertyName);
  if (isGlobalObjectFreeze || isConfigNamespaceCall) {
    return evaluateExpression(
      argumentsList[0],
      variableInitializers,
      bindings,
      configDirectory,
      visitedIdentifiers,
    );
  }
  if (isGlobalRequireResolve) {
    const requiredPath = evaluateExpression(
      argumentsList[0],
      variableInitializers,
      bindings,
      configDirectory,
      visitedIdentifiers,
    );
    return typeof requiredPath === "string" && requiredPath.startsWith(".")
      ? resolve(configDirectory, requiredPath)
      : undefined;
  }
  const isPathCall =
    directBinding?.kind === "path-function" ||
    (memberObjectBinding?.kind === "path-namespace" &&
      ["join", "resolve"].includes(memberPropertyName ?? ""));
  if (isPathCall) {
    const pathSegments = argumentsList.map((argument) =>
      evaluateExpression(
        argument,
        variableInitializers,
        bindings,
        configDirectory,
        visitedIdentifiers,
      ),
    );
    return pathSegments.every((segment) => typeof segment === "string")
      ? resolve(...pathSegments)
      : undefined;
  }
  if (directBinding?.kind === "url-function" && isOxcAstNode(argumentsList[0])) {
    const urlExpression = argumentsList[0];
    if (
      urlExpression.type === "NewExpression" &&
      getIdentifierName(urlExpression.callee) === "URL" &&
      !bindings.has("URL") &&
      Array.isArray(urlExpression.arguments)
    ) {
      const relativePath = evaluateExpression(
        urlExpression.arguments[0],
        variableInitializers,
        bindings,
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
  const bindings = collectStaticConfigBindings(statements);
  for (const statement of statements) {
    if (!isOxcAstNode(statement)) continue;
    if (statement.type === "ExportDefaultDeclaration") {
      return evaluateExpression(
        statement.declaration,
        variableInitializers,
        bindings,
        dirname(configPath),
      );
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
      return evaluateExpression(
        expression.right,
        variableInitializers,
        bindings,
        dirname(configPath),
      );
    }
  }
  const expressionStatement = statements.find(
    (statement) => isOxcAstNode(statement) && statement.type === "ExpressionStatement",
  );
  return isOxcAstNode(expressionStatement)
    ? evaluateExpression(
        expressionStatement.expression,
        variableInitializers,
        bindings,
        dirname(configPath),
      )
    : undefined;
};
