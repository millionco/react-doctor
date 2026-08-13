import { readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import fg from "fast-glob";
import { parseSync } from "oxc-parser";
import { extractJitiLoadReferences } from "../utils/extract-jiti-load-references.js";
import { getIdentifierName, isOxcAstNode, type OxcAstNode } from "../utils/oxc-ast-node.js";
import { resolveEntryWithExtensions } from "../utils/resolve-entry-with-extensions.js";
import { visitOxcAstWithBindings } from "../utils/visit-oxc-ast-with-bindings.js";

const CONFIG_STRING_ENTRY_GLOBS = [
  "webpack.config.{js,ts,mjs,cjs}",
  "**/webpack*.config.{js,ts,mjs,cjs,babel.js}",
  "**/webpack*.conf.{js,ts,mjs,cjs}",
  "**/configs/webpack.config.{js,ts,mjs,cjs,babel.js}",
  "**/configs/webpack*.config.{js,ts,mjs,cjs,babel.js}",
  "jest.config.{js,ts,mjs,cjs,cts}",
  "**/jest.config.{js,ts,mjs,cjs,cts}",
  "vitest.config.{js,ts,mjs,mts}",
  "**/vitest.config.{js,ts,mjs,mts}",
  "**/vitest.*.config.{js,ts,mjs,mts}",
  "vite.config.{js,ts,mjs,mts}",
  "tailwind.config.{js,ts,cjs,mjs}",
  "**/tailwind.config.{js,ts,cjs,mjs}",
  "electron.vite.config.{js,ts,mjs}",
  "electron-builder.config.{js,ts,cjs}",
  "forge.config.{js,ts,cjs,mjs,mts}",
  "esbuild*.ts",
  "**/esbuild.entrypoints.ts",
  "metro.config.{js,ts}",
  "playwright.config.{js,ts}",
  "cypress.config.{js,ts}",
  "rollup.config.{js,ts,mjs,cjs}",
  "rollup.*.config.js",
  "**/.erb/configs/webpack*.config.{js,ts}",
  "**/.erb/configs/webpack.config.*.{js,ts}",
  "**/astro-tina-directive/register.js",
  "rspack.config.{js,ts,mjs,cjs}",
  "rsbuild.config.{js,ts,mjs,cjs}",
  ".umirc.{js,ts,mjs,mts,cjs,cts}",
  "config/config.{js,ts,mjs,mts,cjs,cts}",
  "config/routes*.{js,ts,mjs,mts,cjs,cts}",
  "config/router.config.{js,ts,mjs,mts,cjs,cts}",
  "**/scripts/build.ts",
  "**/scripts/utils/createJestConfig.js",
];

const NEXT_CONFIG_LOADER_GLOBS = ["next.config.{js,ts,mjs,mts,cjs,cts}"];
const PATH_MODULE_NAMES = new Set(["node:path", "path"]);
const SPECIAL_PATH_PROPERTY_NAMES = new Set(["entryPoints", "entrypoint", "environment", "input"]);
const TRANSPARENT_EXPRESSION_TYPES = new Set([
  "ChainExpression",
  "ParenthesizedExpression",
  "TSAsExpression",
  "TSInstantiationExpression",
  "TSNonNullExpression",
  "TSSatisfiesExpression",
  "TSTypeAssertion",
]);

interface ConfigAstState {
  configDirectory: string;
  entries: Set<string>;
  isUmiRouteModule: boolean;
  pathFunctionBindings: Set<string>;
  pathNamespaceBindings: Set<string>;
  projectRootDirectory: string;
}

interface ConfigExpressionContext {
  initializers: ReadonlyMap<string, OxcAstNode>;
  isRouteCollection: boolean;
  shadowedBindings: ReadonlySet<string>;
  visitedIdentifiers: ReadonlySet<string>;
}

interface ConfigAstResult {
  hasAccessConfig: boolean;
  loadingComponentPaths: string[];
  routeComponentPaths: string[];
}

interface PathBindings {
  pathFunctionBindings: Set<string>;
  pathNamespaceBindings: Set<string>;
}

const shouldSkipConfigPath = (rawPath: string): boolean => {
  if (rawPath.includes("*") || rawPath.includes("?")) return true;
  if (rawPath.endsWith(".json") && !rawPath.includes("/src/")) return true;
  if (rawPath.startsWith("node:")) return true;
  if (rawPath.startsWith("@")) return true;
  return false;
};

const addResolvedConfigPath = (
  rawPath: string,
  configDirectory: string,
  projectRootDirectory: string,
  entries: Set<string>,
): void => {
  if (shouldSkipConfigPath(rawPath)) return;

  const rootDirectory = rawPath.startsWith(".") ? configDirectory : projectRootDirectory;
  const normalizedPath = rawPath.startsWith(".") || isAbsolute(rawPath) ? rawPath : `./${rawPath}`;
  const absolutePath = resolve(rootDirectory, normalizedPath);
  const resolvedEntry = resolveEntryWithExtensions(absolutePath);
  if (resolvedEntry) {
    entries.add(resolvedEntry);
    return;
  }

  if (rawPath.startsWith(".")) {
    const projectRootResolvedEntry = resolveEntryWithExtensions(
      resolve(projectRootDirectory, rawPath),
    );
    if (projectRootResolvedEntry) entries.add(projectRootResolvedEntry);
  }
};

const getStaticString = (
  expression: unknown,
  initializers: ReadonlyMap<string, OxcAstNode>,
  visitedIdentifiers = new Set<string>(),
  shadowedBindings: ReadonlySet<string> = new Set(),
): string | undefined => {
  if (!isOxcAstNode(expression)) return undefined;
  if (TRANSPARENT_EXPRESSION_TYPES.has(expression.type)) {
    return getStaticString(
      expression.expression,
      initializers,
      visitedIdentifiers,
      shadowedBindings,
    );
  }
  if (expression.type === "Literal" && typeof expression.value === "string") {
    return expression.value;
  }
  if (expression.type === "TemplateLiteral") {
    const expressions = Array.isArray(expression.expressions) ? expression.expressions : [];
    const quasis = Array.isArray(expression.quasis) ? expression.quasis : [];
    if (expressions.length > 0 || quasis.length !== 1 || !isOxcAstNode(quasis[0])) return undefined;
    const quasiValue = quasis[0].value;
    if (!quasiValue || typeof quasiValue !== "object") return undefined;
    const cookedValue = Object.entries(quasiValue).find(([key]) => key === "cooked")?.[1];
    return typeof cookedValue === "string" ? cookedValue : undefined;
  }
  if (expression.type === "BinaryExpression" && expression.operator === "+") {
    const leftValue = getStaticString(
      expression.left,
      initializers,
      visitedIdentifiers,
      shadowedBindings,
    );
    const rightValue = getStaticString(
      expression.right,
      initializers,
      visitedIdentifiers,
      shadowedBindings,
    );
    return leftValue === undefined || rightValue === undefined ? undefined : leftValue + rightValue;
  }
  const identifierName = getIdentifierName(expression);
  if (!identifierName || visitedIdentifiers.has(identifierName)) {
    return undefined;
  }
  const initializer = initializers.get(identifierName);
  if (shadowedBindings.has(identifierName) && !initializer) return undefined;
  return initializer
    ? getStaticString(
        initializer,
        initializers,
        new Set(visitedIdentifiers).add(identifierName),
        shadowedBindings,
      )
    : undefined;
};

const getPropertyName = (property: OxcAstNode): string | undefined => {
  if (property.type !== "Property" || property.computed === true) return undefined;
  const identifierName = getIdentifierName(property.key);
  if (identifierName) return identifierName;
  return isOxcAstNode(property.key) &&
    property.key.type === "Literal" &&
    typeof property.key.value === "string"
    ? property.key.value
    : undefined;
};

const getMemberPath = (expression: unknown): string[] => {
  if (!isOxcAstNode(expression)) return [];
  const identifierName = getIdentifierName(expression);
  if (identifierName) return [identifierName];
  if (expression.type !== "MemberExpression" || expression.computed === true) return [];
  const objectPath = getMemberPath(expression.object);
  const propertyName = getIdentifierName(expression.property);
  return propertyName ? [...objectPath, propertyName] : [];
};

const collectPatternBindingNames = (pattern: unknown, bindingNames: Set<string>): void => {
  if (!isOxcAstNode(pattern)) return;
  const identifierName = getIdentifierName(pattern);
  if (identifierName) {
    bindingNames.add(identifierName);
    return;
  }
  if (pattern.type === "AssignmentPattern") {
    collectPatternBindingNames(pattern.left, bindingNames);
    return;
  }
  if (pattern.type === "RestElement") {
    collectPatternBindingNames(pattern.argument, bindingNames);
    return;
  }
  const childValues =
    pattern.type === "ArrayPattern"
      ? pattern.elements
      : pattern.type === "ObjectPattern"
        ? pattern.properties
        : [];
  if (!Array.isArray(childValues)) return;
  for (const childValue of childValues) {
    if (!isOxcAstNode(childValue)) continue;
    collectPatternBindingNames(
      childValue.type === "Property" ? childValue.value : childValue.argument,
      bindingNames,
    );
  }
};

const collectVariableInitializers = (
  statements: unknown[],
  inheritedInitializers: ReadonlyMap<string, OxcAstNode> = new Map(),
): Map<string, OxcAstNode> => {
  const initializers = new Map(inheritedInitializers);
  for (const statementValue of statements) {
    if (!isOxcAstNode(statementValue)) continue;
    const statement =
      statementValue.type === "ExportNamedDeclaration" && isOxcAstNode(statementValue.declaration)
        ? statementValue.declaration
        : statementValue;
    if (statement.type !== "VariableDeclaration") continue;
    const declarations = Array.isArray(statement.declarations) ? statement.declarations : [];
    for (const declaration of declarations) {
      if (!isOxcAstNode(declaration) || !isOxcAstNode(declaration.init)) continue;
      const identifierName = getIdentifierName(declaration.id);
      if (identifierName) initializers.set(identifierName, declaration.init);
    }
  }
  return initializers;
};

const getRequiredModuleName = (expression: unknown): string | undefined => {
  if (!isOxcAstNode(expression) || expression.type !== "CallExpression") return undefined;
  if (getIdentifierName(expression.callee) !== "require") return undefined;
  const argumentsList = Array.isArray(expression.arguments) ? expression.arguments : [];
  return getStaticString(argumentsList[0], new Map());
};

const collectPathBindings = (statements: unknown[]): PathBindings => {
  const pathFunctionBindings = new Set<string>();
  const pathNamespaceBindings = new Set<string>();
  for (const statement of statements) {
    if (!isOxcAstNode(statement)) continue;
    if (statement.type === "ImportDeclaration") {
      const moduleName = getStaticString(statement.source, new Map());
      if (!moduleName || !PATH_MODULE_NAMES.has(moduleName)) continue;
      const specifiers = Array.isArray(statement.specifiers) ? statement.specifiers : [];
      for (const specifier of specifiers) {
        if (!isOxcAstNode(specifier)) continue;
        const localName = getIdentifierName(specifier.local);
        if (!localName) continue;
        if (
          specifier.type === "ImportDefaultSpecifier" ||
          specifier.type === "ImportNamespaceSpecifier"
        ) {
          pathNamespaceBindings.add(localName);
          continue;
        }
        const importedName = getIdentifierName(specifier.imported);
        if (importedName === "join" || importedName === "resolve") {
          pathFunctionBindings.add(localName);
        }
      }
      continue;
    }
    if (statement.type !== "VariableDeclaration") continue;
    const declarations = Array.isArray(statement.declarations) ? statement.declarations : [];
    for (const declaration of declarations) {
      if (!isOxcAstNode(declaration) || !isOxcAstNode(declaration.init)) continue;
      const moduleName = getRequiredModuleName(declaration.init);
      const identifierName = getIdentifierName(declaration.id);
      if (moduleName && PATH_MODULE_NAMES.has(moduleName) && identifierName) {
        pathNamespaceBindings.add(identifierName);
        continue;
      }
      if (!moduleName || !PATH_MODULE_NAMES.has(moduleName) || !isOxcAstNode(declaration.id)) {
        continue;
      }
      const properties =
        declaration.id.type === "ObjectPattern" && Array.isArray(declaration.id.properties)
          ? declaration.id.properties
          : [];
      for (const property of properties) {
        if (!isOxcAstNode(property) || property.type !== "Property") continue;
        const importedName = getIdentifierName(property.key);
        const localName = getIdentifierName(property.value);
        if ((importedName === "join" || importedName === "resolve") && localName) {
          pathFunctionBindings.add(localName);
        }
      }
    }
  }
  return { pathFunctionBindings, pathNamespaceBindings };
};

const isTrustedPathCall = (
  callExpression: OxcAstNode,
  state: ConfigAstState,
  shadowedBindings: ReadonlySet<string>,
): boolean => {
  if (callExpression.type !== "CallExpression" || !isOxcAstNode(callExpression.callee)) {
    return false;
  }
  const directCalleeName = getIdentifierName(callExpression.callee);
  if (directCalleeName) {
    return (
      state.pathFunctionBindings.has(directCalleeName) && !shadowedBindings.has(directCalleeName)
    );
  }
  const memberPath = getMemberPath(callExpression.callee);
  return (
    memberPath.length === 2 &&
    state.pathNamespaceBindings.has(memberPath[0]) &&
    !shadowedBindings.has(memberPath[0]) &&
    (memberPath[1] === "join" || memberPath[1] === "resolve")
  );
};

const evaluatePathExpression = (
  expression: unknown,
  state: ConfigAstState,
  context: ConfigExpressionContext,
): string | undefined => {
  if (!isOxcAstNode(expression)) return undefined;
  if (getIdentifierName(expression) === "__dirname" && !context.shadowedBindings.has("__dirname")) {
    return state.configDirectory;
  }
  const staticString = getStaticString(expression, context.initializers);
  if (staticString !== undefined) return staticString;
  if (!isTrustedPathCall(expression, state, context.shadowedBindings)) return undefined;
  const argumentsList = Array.isArray(expression.arguments) ? expression.arguments : [];
  const pathSegments = argumentsList.map((argument) =>
    evaluatePathExpression(argument, state, context),
  );
  if (pathSegments.some((segment) => segment === undefined)) return undefined;
  const resolvedSegments = pathSegments.flatMap((segment) => (segment ? [segment] : []));
  return resolve(state.configDirectory, ...resolvedSegments);
};

const addStaticConfigPath = (rawPath: string, state: ConfigAstState): void => {
  const rootDirectoryMarker = "<rootDir>/";
  const normalizedPath = rawPath.startsWith(rootDirectoryMarker)
    ? rawPath.slice(rootDirectoryMarker.length)
    : rawPath;
  if (!normalizedPath.startsWith(".") && !normalizedPath.startsWith("config/")) {
    return;
  }
  addResolvedConfigPath(
    normalizedPath,
    state.configDirectory,
    state.projectRootDirectory,
    state.entries,
  );
};

const collectStaticStrings = (
  expression: unknown,
  state: ConfigAstState,
  context: ConfigExpressionContext,
): void => {
  if (!isOxcAstNode(expression)) return;
  const staticString = getStaticString(
    expression,
    context.initializers,
    new Set(),
    context.shadowedBindings,
  );
  if (staticString !== undefined) {
    addResolvedConfigPath(
      staticString,
      state.configDirectory,
      state.projectRootDirectory,
      state.entries,
    );
    return;
  }
  if (expression.type !== "ArrayExpression") return;
  const elements = Array.isArray(expression.elements) ? expression.elements : [];
  for (const element of elements) {
    if (!isOxcAstNode(element)) continue;
    collectStaticStrings(
      element.type === "SpreadElement" ? element.argument : element,
      state,
      context,
    );
  }
};

const collectFunctionBindings = (functionExpression: OxcAstNode): Set<string> => {
  const bindingNames = new Set<string>();
  const parameters = Array.isArray(functionExpression.params) ? functionExpression.params : [];
  for (const parameter of parameters) collectPatternBindingNames(parameter, bindingNames);
  if (!isOxcAstNode(functionExpression.body) || functionExpression.body.type !== "BlockStatement") {
    return bindingNames;
  }
  const statements = Array.isArray(functionExpression.body.body)
    ? functionExpression.body.body
    : [];
  for (const statement of statements) {
    if (!isOxcAstNode(statement)) continue;
    if (statement.type === "VariableDeclaration") {
      const declarations = Array.isArray(statement.declarations) ? statement.declarations : [];
      for (const declaration of declarations) {
        if (isOxcAstNode(declaration)) collectPatternBindingNames(declaration.id, bindingNames);
      }
    } else if (statement.type === "FunctionDeclaration" || statement.type === "ClassDeclaration") {
      collectPatternBindingNames(statement.id, bindingNames);
    }
  }
  return bindingNames;
};

const collectReturnedConfigExpressions = (
  value: unknown,
  collectExpression: (expression: unknown) => void,
): void => {
  if (Array.isArray(value)) {
    for (const child of value) collectReturnedConfigExpressions(child, collectExpression);
    return;
  }
  if (!isOxcAstNode(value)) return;
  if (value.type === "ReturnStatement") {
    collectExpression(value.argument);
    return;
  }
  if (
    value.type === "ArrowFunctionExpression" ||
    value.type === "FunctionExpression" ||
    value.type === "FunctionDeclaration"
  ) {
    return;
  }
  for (const child of Object.values(value)) {
    collectReturnedConfigExpressions(child, collectExpression);
  }
};

const collectConfigExpression = (
  expression: unknown,
  state: ConfigAstState,
  result: ConfigAstResult,
  context: ConfigExpressionContext,
): void => {
  if (!isOxcAstNode(expression)) return;
  if (TRANSPARENT_EXPRESSION_TYPES.has(expression.type)) {
    collectConfigExpression(expression.expression, state, result, context);
    return;
  }
  const identifierName = getIdentifierName(expression);
  if (identifierName) {
    if (context.visitedIdentifiers.has(identifierName)) {
      return;
    }
    const initializer = context.initializers.get(identifierName);
    if (context.shadowedBindings.has(identifierName) && !initializer) return;
    if (!initializer) return;
    collectConfigExpression(initializer, state, result, {
      ...context,
      visitedIdentifiers: new Set(context.visitedIdentifiers).add(identifierName),
    });
    return;
  }
  const staticString = getStaticString(
    expression,
    context.initializers,
    new Set(),
    context.shadowedBindings,
  );
  if (staticString !== undefined) {
    addStaticConfigPath(staticString, state);
    return;
  }
  if (isTrustedPathCall(expression, state, context.shadowedBindings)) {
    const pathValue = evaluatePathExpression(expression, state, context);
    if (pathValue) {
      addResolvedConfigPath(
        pathValue,
        state.configDirectory,
        state.projectRootDirectory,
        state.entries,
      );
    }
    const argumentsList = Array.isArray(expression.arguments) ? expression.arguments : [];
    const firstArgumentPath = getMemberPath(argumentsList[0]);
    const trailingPath = getStaticString(
      argumentsList[1],
      context.initializers,
      new Set(),
      context.shadowedBindings,
    );
    if (trailingPath && firstArgumentPath.join(".") === "webpackPaths.srcRendererPath") {
      addResolvedConfigPath(
        `src/renderer/${trailingPath}`,
        state.configDirectory,
        state.projectRootDirectory,
        state.entries,
      );
    }
    if (trailingPath && firstArgumentPath.join(".") === "webpackPaths.srcMainPath") {
      addResolvedConfigPath(
        `src/main/${trailingPath}`,
        state.configDirectory,
        state.projectRootDirectory,
        state.entries,
      );
    }
    return;
  }
  if (expression.type === "ArrayExpression") {
    const elements = Array.isArray(expression.elements) ? expression.elements : [];
    for (const element of elements) {
      if (!isOxcAstNode(element)) continue;
      collectConfigExpression(
        element.type === "SpreadElement" ? element.argument : element,
        state,
        result,
        context,
      );
    }
    return;
  }
  if (expression.type === "ObjectExpression") {
    const properties = Array.isArray(expression.properties) ? expression.properties : [];
    for (const property of properties) {
      if (!isOxcAstNode(property)) continue;
      if (property.type === "SpreadElement") {
        collectConfigExpression(property.argument, state, result, context);
        continue;
      }
      const propertyName = getPropertyName(property);
      if (!propertyName) continue;
      if (SPECIAL_PATH_PROPERTY_NAMES.has(propertyName)) {
        collectStaticStrings(property.value, state, context);
      }
      const propertyString = getStaticString(
        property.value,
        context.initializers,
        new Set(),
        context.shadowedBindings,
      );
      if (
        propertyName === "component" &&
        context.isRouteCollection &&
        propertyString &&
        (propertyString.startsWith("@/") ||
          (state.isUmiRouteModule && propertyString.startsWith(".")))
      ) {
        result.routeComponentPaths.push(propertyString);
      }
      if (propertyName === "loadingComponent" && propertyString) {
        result.loadingComponentPaths.push(propertyString);
      }
      if (
        propertyName === "access" &&
        isOxcAstNode(property.value) &&
        property.value.type === "ObjectExpression"
      ) {
        result.hasAccessConfig = true;
      }
      collectConfigExpression(property.value, state, result, {
        ...context,
        isRouteCollection: propertyName === "routes",
      });
    }
    return;
  }
  if (
    expression.type === "ArrowFunctionExpression" ||
    expression.type === "FunctionExpression" ||
    expression.type === "FunctionDeclaration"
  ) {
    const shadowedBindings = new Set(context.shadowedBindings);
    const functionBindings = collectFunctionBindings(expression);
    for (const functionBinding of functionBindings) shadowedBindings.add(functionBinding);
    const inheritedInitializers = new Map(context.initializers);
    for (const functionBinding of functionBindings) inheritedInitializers.delete(functionBinding);
    if (!isOxcAstNode(expression.body)) return;
    if (expression.body.type !== "BlockStatement") {
      collectConfigExpression(expression.body, state, result, {
        ...context,
        initializers: inheritedInitializers,
        shadowedBindings,
      });
      return;
    }
    const statements = Array.isArray(expression.body.body) ? expression.body.body : [];
    const localInitializers = collectVariableInitializers(statements);
    const initializers = new Map(inheritedInitializers);
    for (const [bindingName, initializer] of localInitializers) {
      initializers.set(bindingName, initializer);
    }
    collectReturnedConfigExpressions(expression.body, (returnedExpression) => {
      collectConfigExpression(returnedExpression, state, result, {
        ...context,
        initializers,
        shadowedBindings,
      });
    });
    return;
  }
  if (expression.type === "CallExpression") {
    const argumentsList = Array.isArray(expression.arguments) ? expression.arguments : [];
    for (const argument of argumentsList) {
      collectConfigExpression(argument, state, result, context);
    }
    return;
  }
  for (const [key, value] of Object.entries(expression)) {
    if (["callee", "key", "type"].includes(key)) continue;
    if (Array.isArray(value)) {
      for (const childValue of value) {
        if (isOxcAstNode(childValue)) collectConfigExpression(childValue, state, result, context);
      }
    } else if (isOxcAstNode(value)) {
      collectConfigExpression(value, state, result, context);
    }
  }
};

const isModuleExportsAssignment = (expression: OxcAstNode): boolean =>
  expression.type === "AssignmentExpression" &&
  expression.operator === "=" &&
  getMemberPath(expression.left).join(".") === "module.exports";

const collectConfigAstEntries = (
  content: string,
  configPath: string,
  projectRootDirectory: string,
  entries: Set<string>,
  isUmiRouteModule: boolean,
): ConfigAstResult => {
  const result: ConfigAstResult = {
    hasAccessConfig: false,
    loadingComponentPaths: [],
    routeComponentPaths: [],
  };
  const parsedModule = parseSync(configPath, content, { sourceType: "unambiguous" });
  if (parsedModule.errors.some((error) => error.severity === "Error")) return result;
  const statements = parsedModule.program.body;
  const topLevelInitializers = collectVariableInitializers(statements);
  const { pathFunctionBindings, pathNamespaceBindings } = collectPathBindings(statements);
  const state: ConfigAstState = {
    configDirectory: dirname(configPath),
    entries,
    isUmiRouteModule,
    pathFunctionBindings,
    pathNamespaceBindings,
    projectRootDirectory,
  };
  const context: ConfigExpressionContext = {
    initializers: topLevelInitializers,
    isRouteCollection: isUmiRouteModule,
    shadowedBindings: new Set(),
    visitedIdentifiers: new Set(),
  };
  for (const statement of statements) {
    if (!isOxcAstNode(statement)) continue;
    if (statement.type === "ExportDefaultDeclaration") {
      collectConfigExpression(statement.declaration, state, result, context);
    } else if (
      statement.type === "ExpressionStatement" &&
      isOxcAstNode(statement.expression) &&
      isModuleExportsAssignment(statement.expression)
    ) {
      collectConfigExpression(statement.expression.right, state, result, context);
    }
  }
  visitOxcAstWithBindings(parsedModule.program, (node, bindingNames) => {
    if (node.type === "ImportDeclaration") return false;
    if (node.type !== "CallExpression") return;
    const calleeName = getIdentifierName(node.callee);
    if (calleeName !== "addPreamble" || bindingNames.has("addPreamble")) return;
    const argumentsList = Array.isArray(node.arguments) ? node.arguments : [];
    collectStaticStrings(argumentsList[0], state, context);
  });
  return result;
};

export const extractConfigStringReferencedEntries = (directory: string): string[] => {
  const entries = new Set<string>();
  let hasDeclaredUmiAccessPlugin = false;
  try {
    const packageJson = JSON.parse(readFileSync(resolve(directory, "package.json"), "utf-8"));
    const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
    hasDeclaredUmiAccessPlugin =
      "@umijs/plugin-access" in dependencies || "@umijs/preset-ant-design-pro" in dependencies;
  } catch {}

  const configPaths = fg.sync(CONFIG_STRING_ENTRY_GLOBS, {
    cwd: directory,
    absolute: true,
    onlyFiles: true,
    ignore: ["**/node_modules/**", "**/dist/**"],
    deep: 6,
  });
  const nextConfigPaths = fg.sync(NEXT_CONFIG_LOADER_GLOBS, {
    cwd: directory,
    absolute: true,
    onlyFiles: true,
    ignore: ["**/node_modules/**", "**/dist/**"],
  });

  for (const configPath of nextConfigPaths) {
    try {
      const content = readFileSync(configPath, "utf-8");
      for (const loaderPath of extractJitiLoadReferences(content).flatMap((reference) =>
        reference.path ? [reference.path] : [],
      )) {
        addResolvedConfigPath(loaderPath, dirname(configPath), directory, entries);
      }
    } catch {
      continue;
    }
  }

  for (const configPath of configPaths) {
    try {
      const content = readFileSync(configPath, "utf-8");
      const isUmiRouteModule =
        /(?:^|[\\/])config[\\/](?:routes[^\\/]*|router\.config)\.[^\\/]+$/.test(configPath);
      const astResult = collectConfigAstEntries(
        content,
        configPath,
        directory,
        entries,
        isUmiRouteModule,
      );
      for (const routeComponentPath of astResult.routeComponentPaths) {
        const sourceRelativePath = routeComponentPath.startsWith("@/")
          ? `src/${routeComponentPath.slice(2)}`
          : `src/pages/${routeComponentPath}`;
        addResolvedConfigPath(sourceRelativePath, directory, directory, entries);
      }
      const isUmiConfig = /(?:^|[\\/])(?:\.umirc\.|config[\\/]config\.)/.test(configPath);
      if (isUmiConfig) {
        for (const loadingComponentPath of astResult.loadingComponentPaths) {
          const sourceRelativePath = loadingComponentPath.startsWith("@/")
            ? `src/${loadingComponentPath.slice(2)}`
            : `src/${loadingComponentPath.replace(/^\.\//, "")}`;
          addResolvedConfigPath(sourceRelativePath, directory, directory, entries);
        }
      }
      if (isUmiConfig && (hasDeclaredUmiAccessPlugin || astResult.hasAccessConfig)) {
        addResolvedConfigPath("src/access", directory, directory, entries);
      }
    } catch {
      continue;
    }
  }

  return [...entries];
};
