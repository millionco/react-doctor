import { readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import fg from "fast-glob";
import { parseSync } from "oxc-parser";
import { MAX_PARSE_FILE_SIZE_BYTES } from "../constants.js";
import { getIdentifierName, isOxcAstNode, type OxcAstNode } from "../utils/oxc-ast-node.js";

const SOURCE_FILE_GLOB = "**/*.{ts,tsx,js,jsx,mts,mjs,cts,cjs,es6}";
const DIRECTORY_ROOT_NAME_PATTERN = /(?:root|resource|project|cwd)/i;
const DIRECTORY_CONSUMER_NAMES = new Set(["copySync", "listSync", "readdir", "readdirSync"]);
const FILESYSTEM_MODULE_NAMES = new Set(["fs", "node:fs", "fs/promises", "node:fs/promises"]);
const FILESYSTEM_BASE_MODULE_NAMES = new Set(["fs", "node:fs"]);
const PATH_MODULE_NAMES = new Set(["path", "node:path", "path/posix", "node:path/posix"]);
const TRANSPARENT_EXPRESSION_TYPES = new Set([
  "ChainExpression",
  "ParenthesizedExpression",
  "TSAsExpression",
  "TSInstantiationExpression",
  "TSNonNullExpression",
  "TSSatisfiesExpression",
  "TSTypeAssertion",
]);

const getLiteralString = (node: unknown): string | undefined => {
  if (!isOxcAstNode(node)) return undefined;
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  if (
    node.type === "TemplateLiteral" &&
    Array.isArray(node.expressions) &&
    node.expressions.length === 0 &&
    Array.isArray(node.quasis) &&
    isOxcAstNode(node.quasis[0]) &&
    node.quasis[0].value &&
    typeof node.quasis[0].value === "object" &&
    "cooked" in node.quasis[0].value &&
    typeof node.quasis[0].value.cooked === "string"
  ) {
    return node.quasis[0].value.cooked;
  }
  return undefined;
};

const extendScope = (
  statements: unknown[],
  parentScope: ReadonlyMap<string, OxcAstNode | null>,
): Map<string, OxcAstNode | null> => {
  const scope = new Map(parentScope);
  for (const statement of statements) {
    if (!isOxcAstNode(statement)) continue;
    if (
      (statement.type === "FunctionDeclaration" || statement.type === "ClassDeclaration") &&
      getIdentifierName(statement.id)
    ) {
      const declarationName = getIdentifierName(statement.id);
      if (declarationName) scope.set(declarationName, null);
    }
    if (statement.type !== "VariableDeclaration") continue;
    const declarations = Array.isArray(statement.declarations) ? statement.declarations : [];
    for (const declaration of declarations) {
      if (!isOxcAstNode(declaration)) continue;
      const variableName = getIdentifierName(declaration.id);
      if (!variableName) continue;
      scope.set(
        variableName,
        statement.kind === "const" && isOxcAstNode(declaration.init) ? declaration.init : null,
      );
    }
  }
  return scope;
};

const getMemberPropertyName = (node: OxcAstNode): string | undefined =>
  node.type === "MemberExpression" && node.computed !== true
    ? getIdentifierName(node.property)
    : undefined;

const isRequiredModule = (
  initializer: OxcAstNode | null | undefined,
  moduleNames: ReadonlySet<string>,
): boolean => {
  if (
    !initializer ||
    initializer.type !== "CallExpression" ||
    getIdentifierName(initializer.callee) !== "require" ||
    !Array.isArray(initializer.arguments)
  ) {
    return false;
  }
  const moduleName = getLiteralString(initializer.arguments[0]);
  return moduleName !== undefined && moduleNames.has(moduleName);
};

const evaluateStaticPath = (
  expression: unknown,
  sourcePath: string,
  projectDirectory: string,
  initializers: ReadonlyMap<string, OxcAstNode | null>,
  visitedIdentifiers = new Set<string>(),
): string | undefined => {
  if (!isOxcAstNode(expression)) return undefined;
  if (TRANSPARENT_EXPRESSION_TYPES.has(expression.type)) {
    return evaluateStaticPath(
      expression.expression,
      sourcePath,
      projectDirectory,
      initializers,
      visitedIdentifiers,
    );
  }
  const literalValue = getLiteralString(expression);
  if (literalValue !== undefined) return literalValue;
  const identifierName = getIdentifierName(expression);
  if (identifierName === "__dirname") return dirname(sourcePath);
  if (identifierName) {
    if (visitedIdentifiers.has(identifierName)) return undefined;
    if (initializers.has(identifierName)) {
      const initializer = initializers.get(identifierName);
      if (!initializer) return undefined;
      return evaluateStaticPath(
        initializer,
        sourcePath,
        projectDirectory,
        initializers,
        new Set(visitedIdentifiers).add(identifierName),
      );
    }
    return DIRECTORY_ROOT_NAME_PATTERN.test(identifierName) ? projectDirectory : undefined;
  }
  if (expression.type === "MemberExpression") {
    const propertyName = getMemberPropertyName(expression);
    return propertyName && DIRECTORY_ROOT_NAME_PATTERN.test(propertyName)
      ? projectDirectory
      : undefined;
  }
  if (expression.type !== "CallExpression" || !isOxcAstNode(expression.callee)) return undefined;
  const argumentsList = Array.isArray(expression.arguments) ? expression.arguments : [];
  const memberPropertyName = getMemberPropertyName(expression.callee);
  if (
    memberPropertyName === "cwd" &&
    isOxcAstNode(expression.callee.object) &&
    getIdentifierName(expression.callee.object) === "process" &&
    argumentsList.length === 0
  ) {
    return projectDirectory;
  }
  const isPathCall =
    memberPropertyName !== undefined &&
    ["join", "resolve"].includes(memberPropertyName) &&
    isOxcAstNode(expression.callee.object) &&
    (() => {
      const pathObjectName = getIdentifierName(expression.callee.object);
      if (!pathObjectName) return false;
      return (
        (!initializers.has(pathObjectName) && pathObjectName === "path") ||
        isRequiredModule(initializers.get(pathObjectName), PATH_MODULE_NAMES)
      );
    })();
  if (!isPathCall || argumentsList.length < 2) return undefined;
  const pathSegments = argumentsList.map((argument) =>
    evaluateStaticPath(argument, sourcePath, projectDirectory, initializers, visitedIdentifiers),
  );
  return pathSegments.every((pathSegment): pathSegment is string => pathSegment !== undefined)
    ? resolve(...pathSegments)
    : undefined;
};

const getDirectoryConsumerName = (
  callee: OxcAstNode,
  scope: ReadonlyMap<string, OxcAstNode | null>,
): string | undefined => {
  const directName = getIdentifierName(callee);
  if (directName && DIRECTORY_CONSUMER_NAMES.has(directName) && !scope.has(directName)) {
    return directName;
  }
  const memberName = getMemberPropertyName(callee);
  if (!memberName || !DIRECTORY_CONSUMER_NAMES.has(memberName)) return undefined;
  if (!isOxcAstNode(callee.object)) return undefined;
  const objectName = getIdentifierName(callee.object);
  if (
    objectName &&
    ((!scope.has(objectName) && ["fs", "fsp", "promises"].includes(objectName)) ||
      isRequiredModule(scope.get(objectName), FILESYSTEM_MODULE_NAMES))
  ) {
    return memberName;
  }
  if (
    callee.object.type === "MemberExpression" &&
    (() => {
      const fsObjectName = getIdentifierName(callee.object.object);
      if (!fsObjectName) return false;
      return (
        (!scope.has(fsObjectName) && fsObjectName === "fs") ||
        isRequiredModule(scope.get(fsObjectName), FILESYSTEM_BASE_MODULE_NAMES)
      );
    })() &&
    getMemberPropertyName(callee.object) === "promises"
  ) {
    return memberName;
  }
  return undefined;
};

const collectConsumedDirectories = (
  program: unknown,
  sourcePath: string,
  projectDirectory: string,
): string[] => {
  const consumedDirectories = new Set<string>();
  const visitNode = (
    node: unknown,
    inheritedScope: ReadonlyMap<string, OxcAstNode | null>,
  ): void => {
    if (Array.isArray(node)) {
      for (const child of node) visitNode(child, inheritedScope);
      return;
    }
    if (!isOxcAstNode(node)) return;
    let scope = inheritedScope;
    if ((node.type === "Program" || node.type === "BlockStatement") && Array.isArray(node.body)) {
      scope = extendScope(node.body, inheritedScope);
    }
    if (
      (node.type === "FunctionDeclaration" ||
        node.type === "FunctionExpression" ||
        node.type === "ArrowFunctionExpression") &&
      Array.isArray(node.params)
    ) {
      const functionScope = new Map(scope);
      for (const parameter of node.params) {
        const parameterName = getIdentifierName(parameter);
        if (parameterName) functionScope.set(parameterName, null);
      }
      scope = functionScope;
    }
    if (
      node.type === "CallExpression" &&
      isOxcAstNode(node.callee) &&
      getDirectoryConsumerName(node.callee, scope) &&
      Array.isArray(node.arguments)
    ) {
      const consumedDirectory = evaluateStaticPath(
        node.arguments[0],
        sourcePath,
        projectDirectory,
        scope,
      );
      if (consumedDirectory) consumedDirectories.add(consumedDirectory);
    }
    for (const child of Object.values(node)) visitNode(child, scope);
  };
  visitNode(program, new Map());
  return [...consumedDirectories];
};

export const extractRuntimeConsumedDirectoryFiles = (directory: string): string[] => {
  const consumedFiles = new Set<string>();
  const sourcePaths = fg.sync(SOURCE_FILE_GLOB, {
    cwd: directory,
    absolute: true,
    onlyFiles: true,
    ignore: ["**/node_modules/**", "**/dist/**", "**/build/**"],
  });
  for (const sourcePath of sourcePaths) {
    let source: string;
    try {
      if (statSync(sourcePath).size > MAX_PARSE_FILE_SIZE_BYTES) continue;
      source = readFileSync(sourcePath, "utf-8");
    } catch {
      continue;
    }
    let parsedModule: ReturnType<typeof parseSync>;
    try {
      parsedModule = parseSync(sourcePath, source, { sourceType: "unambiguous" });
    } catch {
      continue;
    }
    if (parsedModule.errors.some((error) => error.severity === "Error")) continue;
    for (const consumedDirectory of collectConsumedDirectories(
      parsedModule.program,
      sourcePath,
      directory,
    )) {
      const resolvedConsumedDirectory = isAbsolute(consumedDirectory)
        ? consumedDirectory
        : resolve(directory, consumedDirectory);
      try {
        if (!statSync(resolvedConsumedDirectory).isDirectory()) continue;
      } catch {
        continue;
      }
      for (const consumedFile of fg.sync(SOURCE_FILE_GLOB, {
        cwd: resolvedConsumedDirectory,
        absolute: true,
        onlyFiles: true,
      })) {
        consumedFiles.add(consumedFile);
      }
    }
  }
  return [...consumedFiles];
};
