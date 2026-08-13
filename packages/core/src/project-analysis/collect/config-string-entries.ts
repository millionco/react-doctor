import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import fg from "fast-glob";
import ts from "typescript";
import { getObjectLiteralElementName } from "../utils/get-object-literal-element-name.js";
import { maskJavaScriptStringsAndComments } from "../utils/mask-javascript-strings-and-comments.js";
import { resolveEntryWithExtensions } from "../utils/resolve-entry-with-extensions.js";
import { extractJitiLoadReferences } from "../utils/extract-jiti-load-references.js";

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

const CONFIG_RELATIVE_PATH_PATTERN = /['"`]((\.{1,2}\/|\.\.\/)[^'"`\n]+?|\.\/[^'"`\n]+?)['"`]/g;

const JEST_ROOT_DIR_PATH_PATTERN = /<rootDir>\/([^'"`\n]+?)(?:['"`]|$)/g;

const RESOLVE_CALL_PATH_PATTERN = /resolve\s*\(\s*['"`]([^'"`\n]+?)['"`]\s*\)/g;

const PATH_JOIN_STRING_PATTERN = /path\.(?:join|resolve)\(\s*[^,]+,\s*['"`]([^'"`\n]+?)['"`]/g;

const ENTRY_POINTS_STRING_PATTERN = /entryPoints:\s*\[\s*['"`]([^'"`\n]+?)['"`]/g;

const ADD_PREAMBLE_PATTERN = /addPreamble\s*\(\s*['"`]([^'"`\n]+?)['"`]\s*\)/g;

const ROLLUP_INPUT_PATTERN = /\binput\s*:\s*['"`]([^'"`\n]+?)['"`]/g;

const VITEST_ENVIRONMENT_PATTERN = /environment\s*:\s*['"`](\.\/[^'"`\n]+?)['"`]/g;

const ASTRO_ENTRYPOINT_PATTERN = /entrypoint\s*:\s*['"`](\.\/[^'"`\n]+?)['"`]/g;

const WEBPACK_PATH_JOIN_ENTRY_PATTERN = /path\.join\(\s*[^,]+,\s*['"`]([^'"`\n]+?)['"`]\s*\)/g;

const WEBPACK_RENDERER_PATH_JOIN_PATTERN =
  /path\.join\(\s*webpackPaths\.srcRendererPath\s*,\s*['"`]([^'"`\n]+?)['"`]\s*\)/g;

const WEBPACK_MAIN_PATH_JOIN_PATTERN =
  /path\.join\(\s*webpackPaths\.srcMainPath\s*,\s*['"`]([^'"`\n]+?)['"`]\s*\)/g;

const BARE_CONFIG_PATH_PATTERN = /['"`](config\/[^'"`\n]+?)['"`]/g;

const stripModuleImportStatements = (content: string): string =>
  content
    .replace(/^\s*import\s+(?:type\s+)?[\s\S]*?\sfrom\s+['"`][^'"`\n]+['"`]\s*;?\s*$/gm, "")
    .replace(/^\s*import\s+['"`][^'"`\n]+['"`]\s*;?\s*$/gm, "");

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
  const normalizedPath = rawPath.startsWith(".") ? rawPath : `./${rawPath}`;
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

const collectResolvedPathsFromStrings = (
  content: string,
  configDirectory: string,
  projectRootDirectory: string,
  entries: Set<string>,
): void => {
  const contentWithoutImports = stripModuleImportStatements(content);

  const patterns = [
    CONFIG_RELATIVE_PATH_PATTERN,
    RESOLVE_CALL_PATH_PATTERN,
    PATH_JOIN_STRING_PATTERN,
    ENTRY_POINTS_STRING_PATTERN,
    ADD_PREAMBLE_PATTERN,
    ROLLUP_INPUT_PATTERN,
    VITEST_ENVIRONMENT_PATTERN,
    ASTRO_ENTRYPOINT_PATTERN,
    WEBPACK_PATH_JOIN_ENTRY_PATTERN,
    BARE_CONFIG_PATH_PATTERN,
  ];

  for (const pattern of patterns) {
    let pathMatch: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((pathMatch = pattern.exec(contentWithoutImports)) !== null) {
      addResolvedConfigPath(pathMatch[1], configDirectory, projectRootDirectory, entries);
    }
  }

  let rendererEntryMatch: RegExpExecArray | null;
  WEBPACK_RENDERER_PATH_JOIN_PATTERN.lastIndex = 0;
  while (
    (rendererEntryMatch = WEBPACK_RENDERER_PATH_JOIN_PATTERN.exec(contentWithoutImports)) !== null
  ) {
    addResolvedConfigPath(
      `src/renderer/${rendererEntryMatch[1]}`,
      configDirectory,
      projectRootDirectory,
      entries,
    );
  }

  let mainEntryMatch: RegExpExecArray | null;
  WEBPACK_MAIN_PATH_JOIN_PATTERN.lastIndex = 0;
  while ((mainEntryMatch = WEBPACK_MAIN_PATH_JOIN_PATTERN.exec(contentWithoutImports)) !== null) {
    addResolvedConfigPath(
      `src/main/${mainEntryMatch[1]}`,
      configDirectory,
      projectRootDirectory,
      entries,
    );
  }

  let rootDirMatch: RegExpExecArray | null;
  JEST_ROOT_DIR_PATH_PATTERN.lastIndex = 0;
  while ((rootDirMatch = JEST_ROOT_DIR_PATH_PATTERN.exec(content)) !== null) {
    addResolvedConfigPath(rootDirMatch[1], configDirectory, projectRootDirectory, entries);
  }
};

const unwrapConfigExpression = (expression: ts.Expression): ts.Expression => {
  if (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isSatisfiesExpression(expression)
  ) {
    return unwrapConfigExpression(expression.expression);
  }
  if (ts.isCallExpression(expression) && expression.arguments[0]) {
    return unwrapConfigExpression(expression.arguments[0]);
  }
  return expression;
};

const extractUmiRouteComponentPaths = (content: string, isRouteModule: boolean): string[] => {
  const sourceFile = ts.createSourceFile(
    "umi-config.ts",
    content,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const variableInitializers = new Map<string, ts.Expression>();
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.initializer) {
        variableInitializers.set(declaration.name.text, declaration.initializer);
      }
    }
  }
  const resolveExpression = (
    expression: ts.Expression,
    visitedIdentifiers = new Set<string>(),
  ): ts.Expression => {
    const unwrappedExpression = unwrapConfigExpression(expression);
    if (ts.isIdentifier(unwrappedExpression) && !visitedIdentifiers.has(unwrappedExpression.text)) {
      const initializer = variableInitializers.get(unwrappedExpression.text);
      if (initializer) {
        return resolveExpression(
          initializer,
          new Set(visitedIdentifiers).add(unwrappedExpression.text),
        );
      }
    }
    return unwrappedExpression;
  };
  const exportAssignment = sourceFile.statements.find(
    (statement): statement is ts.ExportAssignment =>
      ts.isExportAssignment(statement) && !statement.isExportEquals,
  );
  if (!exportAssignment) return [];
  const exportedExpression = resolveExpression(exportAssignment.expression);
  const routeComponentPaths: string[] = [];
  const collectRouteObjects = (expression: ts.Expression): void => {
    const resolvedExpression = resolveExpression(expression);
    if (!ts.isArrayLiteralExpression(resolvedExpression)) return;
    for (const routeElement of resolvedExpression.elements) {
      if (ts.isSpreadElement(routeElement)) {
        collectRouteObjects(routeElement.expression);
        continue;
      }
      const resolvedRouteElement = resolveExpression(routeElement);
      if (!ts.isObjectLiteralExpression(resolvedRouteElement)) continue;
      for (const property of resolvedRouteElement.properties) {
        const propertyName = getObjectLiteralElementName(property);
        if (propertyName === "component" && ts.isPropertyAssignment(property)) {
          const componentExpression = resolveExpression(property.initializer);
          if (
            (ts.isStringLiteral(componentExpression) ||
              ts.isNoSubstitutionTemplateLiteral(componentExpression)) &&
            (componentExpression.text.startsWith("@/") ||
              (isRouteModule && componentExpression.text.startsWith(".")))
          ) {
            routeComponentPaths.push(componentExpression.text);
          }
        }
        if (propertyName === "routes" && ts.isPropertyAssignment(property)) {
          collectRouteObjects(property.initializer);
        }
      }
    }
  };

  if (isRouteModule) {
    collectRouteObjects(exportedExpression);
  } else if (ts.isObjectLiteralExpression(exportedExpression)) {
    for (const property of exportedExpression.properties) {
      if (getObjectLiteralElementName(property) !== "routes") continue;
      if (ts.isPropertyAssignment(property)) collectRouteObjects(property.initializer);
      if (ts.isShorthandPropertyAssignment(property)) {
        const initializer = variableInitializers.get(property.name.text);
        if (initializer) collectRouteObjects(initializer);
      }
    }
  }
  return routeComponentPaths;
};

const extractUmiLoadingComponentPaths = (content: string): string[] => {
  const sourceFile = ts.createSourceFile(
    "umi-config.ts",
    content,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const loadingComponentPaths: string[] = [];
  const visitNode = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node) && getObjectLiteralElementName(node) === "loadingComponent") {
      const initializer = unwrapConfigExpression(node.initializer);
      if (ts.isStringLiteral(initializer) || ts.isNoSubstitutionTemplateLiteral(initializer)) {
        loadingComponentPaths.push(initializer.text);
      }
    }
    ts.forEachChild(node, visitNode);
  };
  visitNode(sourceFile);
  return loadingComponentPaths;
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
      collectResolvedPathsFromStrings(content, dirname(configPath), directory, entries);
      const isUmiRouteModule =
        /(?:^|[\\/])config[\\/](?:routes[^\\/]*|router\.config)\.[^\\/]+$/.test(configPath);
      for (const routeComponentPath of extractUmiRouteComponentPaths(content, isUmiRouteModule)) {
        const sourceRelativePath = routeComponentPath.startsWith("@/")
          ? `src/${routeComponentPath.slice(2)}`
          : `src/pages/${routeComponentPath}`;
        addResolvedConfigPath(sourceRelativePath, directory, directory, entries);
      }
      if (/(?:^|[\\/])(?:\.umirc\.|config[\\/]config\.)/.test(configPath)) {
        for (const loadingComponentPath of extractUmiLoadingComponentPaths(content)) {
          const sourceRelativePath = loadingComponentPath.startsWith("@/")
            ? `src/${loadingComponentPath.slice(2)}`
            : `src/${loadingComponentPath.replace(/^\.\//, "")}`;
          addResolvedConfigPath(sourceRelativePath, directory, directory, entries);
        }
      }
      if (
        /(?:^|[\\/])(?:\.umirc\.|config[\\/]config\.)/.test(configPath) &&
        (hasDeclaredUmiAccessPlugin ||
          /\baccess\s*:\s*\{/.test(maskJavaScriptStringsAndComments(content)))
      ) {
        addResolvedConfigPath("src/access", directory, directory, entries);
      }
    } catch {
      continue;
    }
  }

  return [...entries];
};
