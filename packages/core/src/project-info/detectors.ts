import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import ts from "typescript";
import {
  ES2023_YEAR,
  ES_TARGET_YEAR_BY_NAME,
  REACT_COMPILER_CONFIG_IMPORT_MAX_DEPTH,
  TSCONFIG_EXTENDS_MAX_DEPTH,
} from "../constants.js";
import type { Framework, PackageJson } from "../types/index.js";
import { isProjectBoundary } from "../utils/is-project-boundary.js";
import { isFile, isPlainObject } from "./fs-utils.js";
import { readPackageJson } from "./package-json.js";

const TSCONFIG_FILENAME = "tsconfig.json";

interface TsConfigCompilerOptions {
  readonly target?: string;
  readonly lib?: readonly string[];
  readonly hasExplicitLib: boolean;
}

interface TsConfigShape {
  readonly extends?: string;
  readonly referencePaths: readonly string[];
  readonly compilerOptions: TsConfigCompilerOptions;
}

const isRelativeExtendsValue = (extendsValue: string): boolean =>
  extendsValue.startsWith("./") || extendsValue.startsWith("../") || path.isAbsolute(extendsValue);

const ensureJsonExtension = (filePath: string): string =>
  path.extname(filePath) === "" ? `${filePath}.json` : filePath;

const resolvePackageExtendsPath = (
  extendsValue: string,
  fromConfigDirectory: string,
): string | null => {
  const requireFromConfig = createRequire(path.join(fromConfigDirectory, "tsconfig.json"));
  const candidates = [
    extendsValue,
    ensureJsonExtension(extendsValue),
    `${extendsValue.replace(/\/$/, "")}/tsconfig.json`,
  ];

  for (const candidate of candidates) {
    try {
      return requireFromConfig.resolve(candidate);
    } catch {
      continue;
    }
  }

  return null;
};

const resolveExtendsPath = (extendsValue: string, fromConfigDirectory: string): string | null => {
  if (isRelativeExtendsValue(extendsValue)) {
    return ensureJsonExtension(path.resolve(fromConfigDirectory, extendsValue));
  }

  return resolvePackageExtendsPath(extendsValue, fromConfigDirectory);
};

const normalizeCompilerOptions = (compilerOptions: unknown): TsConfigCompilerOptions => {
  if (!isPlainObject(compilerOptions)) return { hasExplicitLib: false };

  const target = typeof compilerOptions.target === "string" ? compilerOptions.target : undefined;
  const hasExplicitLib = Object.hasOwn(compilerOptions, "lib");
  const lib = Array.isArray(compilerOptions.lib)
    ? compilerOptions.lib.filter((entry): entry is string => typeof entry === "string")
    : undefined;

  return { target, lib, hasExplicitLib };
};

const readTsConfig = (filePath: string): TsConfigShape | null => {
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }

  const parsed = ts.parseConfigFileTextToJson(filePath, content);
  if (!isPlainObject(parsed.config)) return null;

  return {
    extends: typeof parsed.config.extends === "string" ? parsed.config.extends : undefined,
    referencePaths: normalizeReferencePaths(parsed.config.references),
    compilerOptions: normalizeCompilerOptions(parsed.config.compilerOptions),
  };
};

const normalizeReferencePaths = (references: unknown): string[] => {
  if (!Array.isArray(references)) return [];
  return references
    .map((reference) =>
      isPlainObject(reference) && typeof reference.path === "string" ? reference.path : null,
    )
    .filter((referencePath): referencePath is string => referencePath !== null);
};

const mergeCompilerOptions = (
  inherited: TsConfigCompilerOptions | null,
  current: TsConfigCompilerOptions,
): TsConfigCompilerOptions => {
  const target = current.target ?? inherited?.target;
  const hasExplicitLib = current.hasExplicitLib || Boolean(inherited?.hasExplicitLib);
  const lib = current.hasExplicitLib ? current.lib : inherited?.lib;
  return { target, lib, hasExplicitLib };
};

const readResolvedCompilerOptions = (
  tsConfigPath: string,
  extendsDepth: number,
  visitedPaths: ReadonlySet<string>,
): TsConfigCompilerOptions | null => {
  const realPath = fs.realpathSync.native(tsConfigPath);
  if (visitedPaths.has(realPath)) return null;

  const tsConfig = readTsConfig(realPath);
  if (!tsConfig) return null;

  const nextVisitedPaths = new Set(visitedPaths);
  nextVisitedPaths.add(realPath);

  if (tsConfig.extends && extendsDepth < TSCONFIG_EXTENDS_MAX_DEPTH) {
    const parentPath = resolveExtendsPath(tsConfig.extends, path.dirname(realPath));
    if (parentPath && isFile(parentPath)) {
      const inherited = readResolvedCompilerOptions(parentPath, extendsDepth + 1, nextVisitedPaths);
      return mergeCompilerOptions(inherited, tsConfig.compilerOptions);
    }
  }

  return tsConfig.compilerOptions;
};

const targetYearIsPreES2023 = (target: string): boolean => {
  const year = ES_TARGET_YEAR_BY_NAME[target.toLowerCase()];
  return year !== undefined && year < ES2023_YEAR;
};

const libEntryIncludesES2023Array = (entry: string): boolean => {
  const normalizedEntry = entry.toLowerCase();
  if (normalizedEntry === "esnext" || normalizedEntry === "esnext.array") return true;
  const esYearMatch = /^es(\d{4})(?:\.(.+))?$/.exec(normalizedEntry);
  if (!esYearMatch) return false;

  const year = Number(esYearMatch[1]);
  if (year < ES2023_YEAR) return false;

  const component = esYearMatch[2];
  return component === undefined || component === "array";
};

const libIncludesES2023 = (lib: ReadonlyArray<string>): boolean =>
  lib.some(libEntryIncludesES2023Array);

const compilerOptionsArePreES2023 = (compilerOptions: TsConfigCompilerOptions): boolean => {
  if (compilerOptions.target) {
    return targetYearIsPreES2023(compilerOptions.target);
  }

  if (compilerOptions.hasExplicitLib) {
    return !libIncludesES2023(compilerOptions.lib ?? []);
  }

  return false;
};

const compilerOptionsDeclareTargetOrLib = (compilerOptions: TsConfigCompilerOptions): boolean =>
  compilerOptions.hasExplicitLib || compilerOptions.target !== undefined;

const detectPreES2023FromConfig = (
  tsConfigPath: string,
  visitedConfigPaths: ReadonlySet<string> = new Set(),
): boolean => {
  if (visitedConfigPaths.has(tsConfigPath)) return false;
  const compilerOptions = readResolvedCompilerOptions(tsConfigPath, 0, new Set());
  if (!compilerOptions) return false;
  if (!compilerOptionsDeclareTargetOrLib(compilerOptions)) {
    const tsConfig = readTsConfig(tsConfigPath);
    if (!tsConfig) return false;
    const nextVisitedConfigPaths = new Set(visitedConfigPaths);
    nextVisitedConfigPaths.add(tsConfigPath);
    const configDirectory = path.dirname(tsConfigPath);
    return tsConfig.referencePaths.some((referencePath) => {
      const resolvedReferencePath = path.resolve(configDirectory, referencePath);
      const referencedConfigPath = isFile(resolvedReferencePath)
        ? resolvedReferencePath
        : path.join(resolvedReferencePath, TSCONFIG_FILENAME);
      return (
        isFile(referencedConfigPath) &&
        detectPreES2023FromConfig(referencedConfigPath, nextVisitedConfigPaths)
      );
    });
  }
  return compilerOptionsArePreES2023(compilerOptions);
};

export const detectPreES2023Target = (directory: string): boolean => {
  const tsConfigPath = path.join(directory, TSCONFIG_FILENAME);
  if (isFile(tsConfigPath)) return detectPreES2023FromConfig(tsConfigPath);

  for (const fallbackFilename of FALLBACK_TSCONFIG_FILENAMES) {
    const fallbackPath = path.join(directory, fallbackFilename);
    if (isFile(fallbackPath)) return detectPreES2023FromConfig(fallbackPath);
  }

  return false;
};

const FALLBACK_TSCONFIG_FILENAMES = ["tsconfig.app.json", "tsconfig.build.json"] as const;

const FRAMEWORK_PACKAGES: Record<string, Framework> = {
  next: "nextjs",
  "@tanstack/react-start": "tanstack-start",
  "@remix-run/react": "remix",
  gatsby: "gatsby",
  vite: "vite",
  "react-scripts": "cra",
  expo: "expo",
  "react-native": "react-native",
};

const FRAMEWORK_DISPLAY_NAMES: Record<Framework, string> = {
  nextjs: "Next.js",
  "tanstack-start": "TanStack Start",
  vite: "Vite",
  cra: "Create React App",
  remix: "Remix",
  gatsby: "Gatsby",
  expo: "Expo",
  "react-native": "React Native",
  preact: "Preact",
  unknown: "React",
};

export const formatFrameworkName = (framework: Framework): string =>
  FRAMEWORK_DISPLAY_NAMES[framework];

// Preact is treated as a framework only when no React-based framework
// (`next` / `vite` / `react-scripts` / …) AND no `react` itself is
// present — i.e. a pure-Preact codebase with no bundler manifest react-
// doctor recognises. Component libraries that list both `react` and
// `preact` as peer deps stay `unknown`, which is what they were before
// this branch existed; they still pick up a non-null `preactVersion`
// (see `discover-project.ts`) so Preact-bucket rules activate without
// overwriting the framework classification.
export const detectFramework = (dependencies: Record<string, string>): Framework => {
  for (const [packageName, frameworkName] of Object.entries(FRAMEWORK_PACKAGES)) {
    if (dependencies[packageName]) {
      return frameworkName;
    }
  }
  if (dependencies.preact && !dependencies.react) {
    return "preact";
  }
  return "unknown";
};

const MOBILE_FRAMEWORKS: ReadonlySet<Framework> = new Set(["expo", "react-native"]);

// The cross-workspace merge tier: a monorepo whose `apps/mobile` is Expo and
// `apps/web` is Next.js classifies by the WEB framework no matter which
// workspace the walk visits first — the same web-over-mobile priority
// `detectFramework` applies within one manifest. Web wins because it's
// coverage-maximizing: `rn-*` / Expo rules still load via
// `hasReactNativeWorkspace` / `expoVersion`, while the web framework's rules
// gate on this classification alone. Within a tier (two web apps, or two
// mobile apps) the first workspace in walk order keeps the slot; `unknown`
// never displaces anything.
export const frameworkMergeRank = (framework: Framework): number => {
  if (framework === "unknown") return 3;
  return MOBILE_FRAMEWORKS.has(framework) ? 2 : 1;
};

const REACT_COMPILER_LINT_PACKAGES = new Set(["eslint-plugin-react-compiler"]);

const NEXT_CONFIG_FILENAMES = [
  "next.config.js",
  "next.config.mjs",
  "next.config.ts",
  "next.config.cjs",
];

const BABEL_CONFIG_FILENAMES = [
  ".babelrc",
  ".babelrc.js",
  ".babelrc.json",
  ".babelrc.cjs",
  ".babelrc.mjs",
  ".babelrc.cts",
  "babel.config.js",
  "babel.config.json",
  "babel.config.cjs",
  "babel.config.mjs",
  "babel.config.ts",
  "babel.config.cts",
];

const VITE_CONFIG_FILENAMES = [
  "vite.config.js",
  "vite.config.ts",
  "vite.config.mjs",
  "vite.config.mts",
  "vite.config.cjs",
  "vite.config.cts",
  "vitest.config.ts",
  "vitest.config.js",
];

const RSBUILD_CONFIG_FILENAMES = [
  "rsbuild.config.ts",
  "rsbuild.config.js",
  "rsbuild.config.mts",
  "rsbuild.config.mjs",
  "rsbuild.config.cts",
  "rsbuild.config.cjs",
];

const RSPACK_CONFIG_FILENAMES = [
  "rspack.config.ts",
  "rspack.config.js",
  "rspack.config.mts",
  "rspack.config.mjs",
  "rspack.config.cts",
  "rspack.config.cjs",
];

const EXPO_APP_CONFIG_FILENAMES = ["app.json", "app.config.js", "app.config.ts"];

const REACT_COMPILER_CONFIG_FILENAMES = [
  ...NEXT_CONFIG_FILENAMES,
  ...BABEL_CONFIG_FILENAMES,
  ...VITE_CONFIG_FILENAMES,
  ...RSBUILD_CONFIG_FILENAMES,
  ...RSPACK_CONFIG_FILENAMES,
  ...EXPO_APP_CONFIG_FILENAMES,
];

const REACT_COMPILER_CONFIG_SOURCE_EXTENSIONS = [
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".mjs",
  ".mts",
  ".cjs",
  ".cts",
  ".json",
];

// `output: "export"` (static HTML export) in next.config.*. The leading
// `(?:^|[^.\w])` boundary keeps it from matching a nested/namespaced key like
// `experimental.output` or `outputFileTracingRoot`.
const STATIC_EXPORT_OUTPUT_PATTERN = /(?:^|[^.\w])["']?output["']?\s*:\s*["']export["']/m;

const hasCompilerPackage = (
  packageJson: PackageJson,
  compilerPackages: ReadonlySet<string>,
): boolean => {
  const allDependencies = {
    ...packageJson.peerDependencies,
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };
  return Object.keys(allDependencies).some((packageName) => compilerPackages.has(packageName));
};

const hasCompilerPackageInAncestors = (
  directory: string,
  compilerPackages: ReadonlySet<string>,
): boolean => {
  if (isProjectBoundary(directory)) return false;

  let ancestorDirectory = path.dirname(directory);
  while (ancestorDirectory !== path.dirname(ancestorDirectory)) {
    const ancestorPackagePath = path.join(ancestorDirectory, "package.json");
    if (isFile(ancestorPackagePath)) {
      const ancestorPackageJson = readPackageJson(ancestorPackagePath);
      if (hasCompilerPackage(ancestorPackageJson, compilerPackages)) return true;
    }
    if (isProjectBoundary(ancestorDirectory)) return false;
    ancestorDirectory = path.dirname(ancestorDirectory);
  }

  return false;
};

const resolveImportedConfigFile = (
  fromFilePath: string,
  moduleSpecifier: string,
): string | null => {
  const unresolvedPath = path.resolve(path.dirname(fromFilePath), moduleSpecifier);
  const extension = path.extname(unresolvedPath);
  const candidatePaths = extension
    ? [
        unresolvedPath,
        ...REACT_COMPILER_CONFIG_SOURCE_EXTENSIONS.map(
          (sourceExtension) => `${unresolvedPath.slice(0, -extension.length)}${sourceExtension}`,
        ),
      ]
    : [
        unresolvedPath,
        ...REACT_COMPILER_CONFIG_SOURCE_EXTENSIONS.map(
          (sourceExtension) => `${unresolvedPath}${sourceExtension}`,
        ),
        ...REACT_COMPILER_CONFIG_SOURCE_EXTENSIONS.map((sourceExtension) =>
          path.join(unresolvedPath, `index${sourceExtension}`),
        ),
      ];
  return candidatePaths.find(isFile) ?? null;
};

const parseConfigSourceFile = (filePath: string, content: string): ts.SourceFile =>
  filePath.endsWith(".json") || path.basename(filePath) === ".babelrc"
    ? ts.parseJsonText(filePath, content)
    : ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);

const getStaticPropertyName = (propertyName: ts.PropertyName): string | null =>
  ts.isIdentifier(propertyName) || ts.isStringLiteralLike(propertyName)
    ? propertyName.text
    : ts.isComputedPropertyName(propertyName) && ts.isStringLiteralLike(propertyName.expression)
      ? propertyName.expression.text
      : null;

const isCommonJsConfigExportAssignment = (
  node: ts.Node,
  sourceFile: ts.SourceFile,
): node is ts.BinaryExpression =>
  ts.isBinaryExpression(node) &&
  node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
  (node.left.getText(sourceFile) === "module.exports" ||
    node.left.getText(sourceFile) === "exports.default");

const hasExportModifier = (node: ts.Node): boolean =>
  ts.canHaveModifiers(node) &&
  Boolean(ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword));

const getRequireModuleSpecifier = (expression: ts.Expression): string | null => {
  if (
    !ts.isCallExpression(expression) ||
    !ts.isIdentifier(expression.expression) ||
    expression.expression.text !== "require" ||
    expression.arguments.length !== 1
  ) {
    return null;
  }
  const moduleSpecifier = expression.arguments[0];
  return moduleSpecifier && ts.isStringLiteralLike(moduleSpecifier) ? moduleSpecifier.text : null;
};
interface ConfigImportBinding {
  readonly moduleSpecifier: string;
  readonly exportName: string;
  readonly isNamespace: boolean;
}

interface ConfigExpressionAnalysis {
  readonly filePath: string;
  readonly sourceFile: ts.SourceFile;
  readonly importDepth: number;
  readonly visitedModules: ReadonlySet<string>;
  readonly visitedNodes: Set<string>;
  readonly localBindings: ReadonlyMap<string, ts.Expression | null>;
  readonly activeFunctions: ReadonlySet<number>;
}

interface ScopedConfigBinding {
  readonly wasFound: boolean;
  readonly initializer: ts.Expression | null;
}

const bindingNameContainsIdentifier = (
  bindingName: ts.BindingName,
  identifierName: string,
): boolean =>
  ts.isIdentifier(bindingName)
    ? bindingName.text === identifierName
    : bindingName.elements.some(
        (element) =>
          !ts.isOmittedExpression(element) &&
          bindingNameContainsIdentifier(element.name, identifierName),
      );

const hasTopLevelValueBinding = (sourceFile: ts.SourceFile, bindingName: string): boolean =>
  sourceFile.statements.some((statement) => {
    if (ts.isImportDeclaration(statement)) {
      const importClause = statement.importClause;
      if (importClause?.name?.text === bindingName) return true;
      const namedBindings = importClause?.namedBindings;
      return namedBindings
        ? ts.isNamespaceImport(namedBindings)
          ? namedBindings.name.text === bindingName
          : namedBindings.elements.some((element) => element.name.text === bindingName)
        : false;
    }
    if (ts.isVariableStatement(statement)) {
      return statement.declarationList.declarations.some(
        (declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === bindingName,
      );
    }
    return (
      (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
      statement.name?.text === bindingName
    );
  });

const getImportBinding = (
  sourceFile: ts.SourceFile,
  bindingName: string,
): ConfigImportBinding | null => {
  const hasShadowedRequire = hasTopLevelValueBinding(sourceFile, "require");
  for (const statement of sourceFile.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      statement.importClause &&
      !statement.importClause.isTypeOnly &&
      ts.isStringLiteralLike(statement.moduleSpecifier)
    ) {
      if (statement.importClause.name?.text === bindingName) {
        return {
          moduleSpecifier: statement.moduleSpecifier.text,
          exportName: "default",
          isNamespace: false,
        };
      }
      const { namedBindings } = statement.importClause;
      if (
        namedBindings &&
        ts.isNamespaceImport(namedBindings) &&
        namedBindings.name.text === bindingName
      ) {
        return {
          moduleSpecifier: statement.moduleSpecifier.text,
          exportName: "*",
          isNamespace: true,
        };
      }
      if (namedBindings && ts.isNamedImports(namedBindings)) {
        const importSpecifier = namedBindings.elements.find(
          (element) => !element.isTypeOnly && element.name.text === bindingName,
        );
        if (importSpecifier) {
          return {
            moduleSpecifier: statement.moduleSpecifier.text,
            exportName: (importSpecifier.propertyName ?? importSpecifier.name).text,
            isNamespace: false,
          };
        }
      }
    }

    if (!ts.isVariableStatement(statement) || hasShadowedRequire) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!declaration.initializer) continue;
      if (ts.isIdentifier(declaration.name) && declaration.name.text === bindingName) {
        const directModuleSpecifier = getRequireModuleSpecifier(declaration.initializer);
        if (directModuleSpecifier) {
          return {
            moduleSpecifier: directModuleSpecifier,
            exportName: "default",
            isNamespace: true,
          };
        }
        if (
          ts.isPropertyAccessExpression(declaration.initializer) &&
          getRequireModuleSpecifier(declaration.initializer.expression) !== null
        ) {
          return {
            moduleSpecifier: getRequireModuleSpecifier(declaration.initializer.expression) ?? "",
            exportName: declaration.initializer.name.text,
            isNamespace: false,
          };
        }
      }
      if (!ts.isObjectBindingPattern(declaration.name)) continue;
      const bindingElement = declaration.name.elements.find(
        (element) => ts.isIdentifier(element.name) && element.name.text === bindingName,
      );
      const moduleSpecifier = getRequireModuleSpecifier(declaration.initializer);
      if (bindingElement && moduleSpecifier) {
        return {
          moduleSpecifier,
          exportName: bindingElement.propertyName
            ? (getStaticPropertyName(bindingElement.propertyName) ??
              bindingElement.propertyName.getText(sourceFile))
            : bindingElement.name.getText(sourceFile),
          isNamespace: false,
        };
      }
    }
  }
  return null;
};

const getTopLevelBinding = (
  sourceFile: ts.SourceFile,
  bindingName: string,
): ts.Expression | ts.FunctionDeclaration | null => {
  for (const statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement)) {
      const declaration = statement.declarationList.declarations.find(
        (candidate) => ts.isIdentifier(candidate.name) && candidate.name.text === bindingName,
      );
      if (declaration?.initializer) return declaration.initializer;
    }
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === bindingName)
      return statement;
  }
  return null;
};

const getFunctionLocalBindings = (
  functionNode: ts.FunctionLikeDeclaration,
  argumentsList: readonly ts.Expression[],
): Map<string, ts.Expression | null> => {
  const localBindings = new Map<string, ts.Expression | null>();
  functionNode.parameters.forEach((parameter, parameterIndex) => {
    if (ts.isIdentifier(parameter.name)) {
      localBindings.set(
        parameter.name.text,
        argumentsList[parameterIndex] ?? parameter.initializer ?? null,
      );
    }
  });
  return localBindings;
};

const getScopedConfigBinding = (identifier: ts.Identifier): ScopedConfigBinding => {
  let childNode: ts.Node = identifier;
  let currentNode: ts.Node | undefined = identifier.parent;
  while (currentNode && !ts.isSourceFile(currentNode)) {
    if (ts.isBlock(currentNode)) {
      for (const statement of currentNode.statements) {
        if (ts.isVariableStatement(statement)) {
          for (const declaration of statement.declarationList.declarations) {
            if (bindingNameContainsIdentifier(declaration.name, identifier.text)) {
              return {
                wasFound: true,
                initializer:
                  statement.pos < childNode.pos && ts.isIdentifier(declaration.name)
                    ? (declaration.initializer ?? null)
                    : null,
              };
            }
          }
        }
        if (
          (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
          statement.name?.text === identifier.text
        ) {
          return { wasFound: true, initializer: null };
        }
      }
    }
    if (
      ts.isCatchClause(currentNode) &&
      currentNode.variableDeclaration &&
      bindingNameContainsIdentifier(currentNode.variableDeclaration.name, identifier.text)
    ) {
      return {
        wasFound: true,
        initializer: ts.isIdentifier(currentNode.variableDeclaration.name)
          ? (currentNode.variableDeclaration.initializer ?? null)
          : null,
      };
    }
    childNode = currentNode;
    currentNode = currentNode.parent;
  }
  return { wasFound: false, initializer: null };
};

const isCompilerTransformModule = (moduleSpecifier: string, exportName: string): boolean =>
  (moduleSpecifier === "babel-plugin-react-compiler" && exportName === "default") ||
  (moduleSpecifier === "@vitejs/plugin-react" && exportName === "reactCompilerPreset");

interface ReactCompilerFlagState {
  readonly isEnabled: boolean;
}

interface StaticConfigValueState {
  readonly isNullish: boolean;
  readonly isTruthy: boolean;
}

const getAssignedPropertyInitializer = (
  identifier: ts.Identifier,
  propertyName: string,
): ScopedConfigBinding => {
  let bindingScope: ts.Block | ts.SourceFile | null = null;
  let currentNode: ts.Node | undefined = identifier;
  while (currentNode) {
    if (ts.isBlock(currentNode) || ts.isSourceFile(currentNode)) {
      const statementScope = currentNode;
      const hasBinding = statementScope.statements.some((statement) => {
        if (ts.isVariableStatement(statement)) {
          return statement.declarationList.declarations.some((declaration) =>
            bindingNameContainsIdentifier(declaration.name, identifier.text),
          );
        }
        if (
          (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
          statement.name?.text === identifier.text
        ) {
          return true;
        }
        if (!ts.isSourceFile(statementScope) || !ts.isImportDeclaration(statement)) return false;
        const importClause = statement.importClause;
        if (importClause?.name?.text === identifier.text) return true;
        const namedBindings = importClause?.namedBindings;
        return namedBindings
          ? ts.isNamespaceImport(namedBindings)
            ? namedBindings.name.text === identifier.text
            : namedBindings.elements.some((element) => element.name.text === identifier.text)
          : false;
      });
      const isFunctionParameter =
        ts.isBlock(currentNode) &&
        ts.isFunctionLike(currentNode.parent) &&
        currentNode.parent.parameters.some(
          (parameter) => ts.isIdentifier(parameter.name) && parameter.name.text === identifier.text,
        );
      if (hasBinding || isFunctionParameter) {
        bindingScope = currentNode;
        break;
      }
    }
    currentNode = currentNode.parent;
  }
  if (!bindingScope) bindingScope = identifier.getSourceFile();

  let assignedInitializer: ts.Expression | null = null;
  let wasFound = false;
  for (const statement of bindingScope.statements) {
    if (statement.end > identifier.pos) break;
    if (
      !ts.isExpressionStatement(statement) ||
      !ts.isBinaryExpression(statement.expression) ||
      statement.expression.operatorToken.kind !== ts.SyntaxKind.EqualsToken
    ) {
      continue;
    }
    const { left } = statement.expression;
    const assignedObject =
      ts.isPropertyAccessExpression(left) || ts.isElementAccessExpression(left)
        ? left.expression
        : null;
    const assignedPropertyName = ts.isPropertyAccessExpression(left)
      ? left.name.text
      : ts.isElementAccessExpression(left) &&
          left.argumentExpression &&
          ts.isStringLiteralLike(left.argumentExpression)
        ? left.argumentExpression.text
        : null;
    if (
      assignedObject &&
      ts.isIdentifier(assignedObject) &&
      assignedObject.text === identifier.text &&
      assignedPropertyName === propertyName
    ) {
      wasFound = true;
      assignedInitializer = statement.expression.right;
    }
  }
  return { wasFound, initializer: assignedInitializer };
};

const getStaticConfigValueState = (
  expression: ts.Expression,
  analysis: ConfigExpressionAnalysis,
): StaticConfigValueState | null => {
  let unwrappedExpression = expression;
  while (
    ts.isParenthesizedExpression(unwrappedExpression) ||
    ts.isAsExpression(unwrappedExpression) ||
    ts.isTypeAssertionExpression(unwrappedExpression) ||
    ts.isSatisfiesExpression(unwrappedExpression) ||
    ts.isNonNullExpression(unwrappedExpression)
  ) {
    unwrappedExpression = unwrappedExpression.expression;
  }
  if (
    unwrappedExpression.kind === ts.SyntaxKind.NullKeyword ||
    (ts.isIdentifier(unwrappedExpression) && unwrappedExpression.text === "undefined")
  ) {
    return { isNullish: true, isTruthy: false };
  }
  if (
    unwrappedExpression.kind === ts.SyntaxKind.FalseKeyword ||
    (ts.isStringLiteralLike(unwrappedExpression) && unwrappedExpression.text.length === 0) ||
    (ts.isNumericLiteral(unwrappedExpression) && Number(unwrappedExpression.text) === 0)
  ) {
    return { isNullish: false, isTruthy: false };
  }
  if (
    unwrappedExpression.kind === ts.SyntaxKind.TrueKeyword ||
    (ts.isStringLiteralLike(unwrappedExpression) && unwrappedExpression.text.length > 0) ||
    (ts.isNumericLiteral(unwrappedExpression) && Number(unwrappedExpression.text) !== 0) ||
    ts.isObjectLiteralExpression(unwrappedExpression) ||
    ts.isArrayLiteralExpression(unwrappedExpression) ||
    ts.isArrowFunction(unwrappedExpression) ||
    ts.isFunctionExpression(unwrappedExpression)
  ) {
    return { isNullish: false, isTruthy: true };
  }
  if (ts.isIdentifier(unwrappedExpression)) {
    if (analysis.localBindings.has(unwrappedExpression.text)) {
      const localInitializer = analysis.localBindings.get(unwrappedExpression.text);
      return localInitializer ? getStaticConfigValueState(localInitializer, analysis) : null;
    }
    const topLevelBinding = getTopLevelBinding(analysis.sourceFile, unwrappedExpression.text);
    return topLevelBinding && ts.isExpression(topLevelBinding)
      ? getStaticConfigValueState(topLevelBinding, analysis)
      : null;
  }
  if (ts.isConditionalExpression(unwrappedExpression)) {
    const conditionState = getStaticConfigValueState(unwrappedExpression.condition, analysis);
    if (conditionState !== null) {
      return getStaticConfigValueState(
        conditionState.isTruthy ? unwrappedExpression.whenTrue : unwrappedExpression.whenFalse,
        analysis,
      );
    }
    const whenTrueState = getStaticConfigValueState(unwrappedExpression.whenTrue, analysis);
    const whenFalseState = getStaticConfigValueState(unwrappedExpression.whenFalse, analysis);
    return whenTrueState !== null &&
      whenFalseState !== null &&
      whenTrueState.isNullish === whenFalseState.isNullish &&
      whenTrueState.isTruthy === whenFalseState.isTruthy
      ? whenTrueState
      : null;
  }
  if (ts.isBinaryExpression(unwrappedExpression)) {
    const leftState = getStaticConfigValueState(unwrappedExpression.left, analysis);
    if (unwrappedExpression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      if (leftState === null) return null;
      return leftState.isTruthy
        ? getStaticConfigValueState(unwrappedExpression.right, analysis)
        : leftState;
    }
    if (unwrappedExpression.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
      if (leftState === null) return null;
      return leftState.isTruthy
        ? leftState
        : getStaticConfigValueState(unwrappedExpression.right, analysis);
    }
    if (unwrappedExpression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
      if (leftState === null) return null;
      return leftState.isNullish
        ? getStaticConfigValueState(unwrappedExpression.right, analysis)
        : leftState;
    }
  }
  return null;
};

const isStaticallyDisabledConfigExpression = (
  expression: ts.Expression,
  analysis: ConfigExpressionAnalysis,
): boolean => getStaticConfigValueState(expression, analysis)?.isTruthy === false;

const isStaticallyTruthyConfigExpression = (
  expression: ts.Expression,
  analysis: ConfigExpressionAnalysis,
): boolean => getStaticConfigValueState(expression, analysis)?.isTruthy === true;

const isStaticallyNullishConfigExpression = (
  expression: ts.Expression,
  analysis: ConfigExpressionAnalysis,
): boolean => getStaticConfigValueState(expression, analysis)?.isNullish === true;

const isStaticallyNonNullishConfigExpression = (
  expression: ts.Expression,
  analysis: ConfigExpressionAnalysis,
): boolean => getStaticConfigValueState(expression, analysis)?.isNullish === false;

const getReactCompilerFlagState = (
  expression: ts.Expression,
  analysis: ConfigExpressionAnalysis,
): ReactCompilerFlagState | null => {
  let unwrappedExpression = expression;
  while (
    ts.isParenthesizedExpression(unwrappedExpression) ||
    ts.isAsExpression(unwrappedExpression) ||
    ts.isTypeAssertionExpression(unwrappedExpression) ||
    ts.isSatisfiesExpression(unwrappedExpression) ||
    ts.isNonNullExpression(unwrappedExpression)
  ) {
    unwrappedExpression = unwrappedExpression.expression;
  }
  if (ts.isIdentifier(unwrappedExpression)) {
    const assignedBinding = getAssignedPropertyInitializer(unwrappedExpression, "reactCompiler");
    if (assignedBinding.wasFound && assignedBinding.initializer) {
      return {
        isEnabled: !isStaticallyDisabledConfigExpression(assignedBinding.initializer, analysis),
      };
    }
    if (analysis.localBindings.has(unwrappedExpression.text)) {
      const localInitializer = analysis.localBindings.get(unwrappedExpression.text);
      return localInitializer ? getReactCompilerFlagState(localInitializer, analysis) : null;
    }
    const topLevelBinding = getTopLevelBinding(analysis.sourceFile, unwrappedExpression.text);
    return topLevelBinding && ts.isExpression(topLevelBinding)
      ? getReactCompilerFlagState(topLevelBinding, analysis)
      : null;
  }
  if (!ts.isObjectLiteralExpression(unwrappedExpression)) return null;
  for (const property of [...unwrappedExpression.properties].reverse()) {
    if (
      ts.isPropertyAssignment(property) &&
      getStaticPropertyName(property.name) === "reactCompiler"
    ) {
      return { isEnabled: !isStaticallyDisabledConfigExpression(property.initializer, analysis) };
    }
    if (ts.isShorthandPropertyAssignment(property) && property.name.text === "reactCompiler") {
      return { isEnabled: !isStaticallyDisabledConfigExpression(property.name, analysis) };
    }
    if (ts.isSpreadAssignment(property)) {
      const spreadState = getReactCompilerFlagState(property.expression, analysis);
      if (spreadState) return spreadState;
    }
  }
  return null;
};

const getSelectedObjectProperty = (
  expression: ts.Expression,
  propertyName: string,
  analysis: ConfigExpressionAnalysis,
): ts.Expression | ts.MethodDeclaration | null => {
  let resolvedExpression = expression;
  while (
    ts.isParenthesizedExpression(resolvedExpression) ||
    ts.isAsExpression(resolvedExpression) ||
    ts.isTypeAssertionExpression(resolvedExpression) ||
    ts.isSatisfiesExpression(resolvedExpression) ||
    ts.isNonNullExpression(resolvedExpression)
  ) {
    resolvedExpression = resolvedExpression.expression;
  }
  if (ts.isIdentifier(resolvedExpression)) {
    if (analysis.localBindings.has(resolvedExpression.text)) {
      const localInitializer = analysis.localBindings.get(resolvedExpression.text);
      return localInitializer
        ? getSelectedObjectProperty(localInitializer, propertyName, analysis)
        : null;
    }
    const scopedBinding = getScopedConfigBinding(resolvedExpression);
    if (scopedBinding.wasFound) {
      return scopedBinding.initializer
        ? getSelectedObjectProperty(scopedBinding.initializer, propertyName, analysis)
        : null;
    }
    const topLevelBinding = getTopLevelBinding(analysis.sourceFile, resolvedExpression.text);
    return topLevelBinding && ts.isExpression(topLevelBinding)
      ? getSelectedObjectProperty(topLevelBinding, propertyName, analysis)
      : null;
  }
  if (!ts.isObjectLiteralExpression(resolvedExpression)) return null;
  for (const property of [...resolvedExpression.properties].reverse()) {
    if (
      ts.isPropertyAssignment(property) &&
      getStaticPropertyName(property.name) === propertyName
    ) {
      return property.initializer;
    }
    if (ts.isMethodDeclaration(property) && getStaticPropertyName(property.name) === propertyName) {
      return property;
    }
    if (ts.isShorthandPropertyAssignment(property) && property.name.text === propertyName) {
      return property.name;
    }
    if (ts.isSpreadAssignment(property)) {
      const spreadProperty = getSelectedObjectProperty(property.expression, propertyName, analysis);
      if (spreadProperty) return spreadProperty;
    }
  }
  return null;
};

const configExpressionMayDefineProperty = (
  expression: ts.Expression,
  propertyName: string,
  analysis: ConfigExpressionAnalysis,
): boolean => {
  let resolvedExpression = expression;
  while (
    ts.isParenthesizedExpression(resolvedExpression) ||
    ts.isAsExpression(resolvedExpression) ||
    ts.isTypeAssertionExpression(resolvedExpression) ||
    ts.isSatisfiesExpression(resolvedExpression) ||
    ts.isNonNullExpression(resolvedExpression)
  ) {
    resolvedExpression = resolvedExpression.expression;
  }
  if (ts.isIdentifier(resolvedExpression)) {
    if (analysis.localBindings.has(resolvedExpression.text)) {
      const localInitializer = analysis.localBindings.get(resolvedExpression.text);
      return localInitializer
        ? configExpressionMayDefineProperty(localInitializer, propertyName, analysis)
        : true;
    }
    const scopedBinding = getScopedConfigBinding(resolvedExpression);
    if (scopedBinding.wasFound) {
      return scopedBinding.initializer
        ? configExpressionMayDefineProperty(scopedBinding.initializer, propertyName, analysis)
        : true;
    }
    const topLevelBinding = getTopLevelBinding(analysis.sourceFile, resolvedExpression.text);
    return topLevelBinding && ts.isExpression(topLevelBinding)
      ? configExpressionMayDefineProperty(topLevelBinding, propertyName, analysis)
      : true;
  }
  if (ts.isConditionalExpression(resolvedExpression)) {
    if (isStaticallyTruthyConfigExpression(resolvedExpression.condition, analysis)) {
      return configExpressionMayDefineProperty(resolvedExpression.whenTrue, propertyName, analysis);
    }
    if (isStaticallyDisabledConfigExpression(resolvedExpression.condition, analysis)) {
      return configExpressionMayDefineProperty(
        resolvedExpression.whenFalse,
        propertyName,
        analysis,
      );
    }
    return (
      configExpressionMayDefineProperty(resolvedExpression.whenTrue, propertyName, analysis) ||
      configExpressionMayDefineProperty(resolvedExpression.whenFalse, propertyName, analysis)
    );
  }
  if (!ts.isObjectLiteralExpression(resolvedExpression)) return true;
  return resolvedExpression.properties.some((property) => {
    if (ts.isSpreadAssignment(property)) {
      return configExpressionMayDefineProperty(property.expression, propertyName, analysis);
    }
    if (
      ts.isPropertyAssignment(property) ||
      ts.isShorthandPropertyAssignment(property) ||
      ts.isMethodDeclaration(property) ||
      ts.isGetAccessorDeclaration(property) ||
      ts.isSetAccessorDeclaration(property)
    ) {
      const staticPropertyName = getStaticPropertyName(property.name);
      return staticPropertyName === null || staticPropertyName === propertyName;
    }
    return false;
  });
};

const getExportedConfigNodes = (sourceFile: ts.SourceFile, exportName: string): ts.Node[] => {
  const exportedNodes: ts.Node[] = [];
  const commonJsExportedNodes: ts.Node[] = [];
  const isJsonConfig =
    sourceFile.fileName.endsWith(".json") || path.basename(sourceFile.fileName) === ".babelrc";
  if (isJsonConfig && exportName === "default") {
    return sourceFile.statements.flatMap((statement) =>
      ts.isExpressionStatement(statement) ? [statement.expression] : [],
    );
  }

  for (const statement of sourceFile.statements) {
    if (exportName === "default" && ts.isExportAssignment(statement)) {
      exportedNodes.push(statement.expression);
    }
    if (
      exportName === "default" &&
      (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
      hasExportModifier(statement) &&
      ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)
    ) {
      exportedNodes.push(statement);
    }
    if (
      ts.isExpressionStatement(statement) &&
      isCommonJsConfigExportAssignment(statement.expression, sourceFile) &&
      exportName === "default"
    ) {
      commonJsExportedNodes.length = 0;
      commonJsExportedNodes.push(statement.expression.right);
      continue;
    }
    if (
      ts.isExpressionStatement(statement) &&
      isCommonJsConfigExportAssignment(statement.expression, sourceFile) &&
      exportName !== "default" &&
      ts.isObjectLiteralExpression(statement.expression.right)
    ) {
      for (const property of [...statement.expression.right.properties].reverse()) {
        if (
          ts.isPropertyAssignment(property) &&
          getStaticPropertyName(property.name) === exportName
        ) {
          exportedNodes.push(property.initializer);
          break;
        }
        if (ts.isShorthandPropertyAssignment(property) && property.name.text === exportName) {
          exportedNodes.push(property.name);
          break;
        }
      }
    }
    if (
      ts.isExpressionStatement(statement) &&
      ts.isBinaryExpression(statement.expression) &&
      statement.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      statement.expression.left.getText(sourceFile) === `exports.${exportName}`
    ) {
      exportedNodes.push(statement.expression.right);
    }
    if (
      exportName === "default" &&
      ts.isExpressionStatement(statement) &&
      ts.isBinaryExpression(statement.expression) &&
      statement.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      (ts.isPropertyAccessExpression(statement.expression.left) ||
        ts.isElementAccessExpression(statement.expression.left))
    ) {
      const assignmentTarget = statement.expression.left;
      const assignmentObjectText = assignmentTarget.expression.getText(sourceFile);
      const assignmentPropertyName = ts.isPropertyAccessExpression(assignmentTarget)
        ? assignmentTarget.name.text
        : assignmentTarget.argumentExpression &&
            ts.isStringLiteralLike(assignmentTarget.argumentExpression)
          ? assignmentTarget.argumentExpression.text
          : null;
      if (
        assignmentPropertyName &&
        (assignmentObjectText === "module.exports" ||
          assignmentObjectText === "exports" ||
          assignmentObjectText === "exports.default")
      ) {
        commonJsExportedNodes.push(statement.expression);
        continue;
      }
    }
    if (ts.isVariableStatement(statement) && hasExportModifier(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (
          ts.isIdentifier(declaration.name) &&
          declaration.name.text === exportName &&
          declaration.initializer
        ) {
          exportedNodes.push(declaration.initializer);
        }
      }
    }
    if (
      ts.isFunctionDeclaration(statement) &&
      hasExportModifier(statement) &&
      statement.name?.text === exportName
    ) {
      exportedNodes.push(statement);
    }
    if (
      ts.isExportDeclaration(statement) &&
      !statement.moduleSpecifier &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const exportSpecifier of statement.exportClause.elements) {
        if (exportSpecifier.name.text === exportName)
          exportedNodes.push(exportSpecifier.propertyName ?? exportSpecifier.name);
      }
    }
  }
  return [...exportedNodes, ...commonJsExportedNodes];
};

const getReExportedConfigModules = (
  sourceFile: ts.SourceFile,
  exportName: string,
): ConfigImportBinding[] => {
  const bindings: ConfigImportBinding[] = [];
  for (const statement of sourceFile.statements) {
    if (
      !ts.isExportDeclaration(statement) ||
      statement.isTypeOnly ||
      !statement.moduleSpecifier ||
      !ts.isStringLiteralLike(statement.moduleSpecifier)
    ) {
      continue;
    }
    if (!statement.exportClause && exportName !== "default") {
      bindings.push({
        moduleSpecifier: statement.moduleSpecifier.text,
        exportName,
        isNamespace: true,
      });
      continue;
    }
    if (!statement.exportClause || !ts.isNamedExports(statement.exportClause)) continue;
    for (const exportSpecifier of statement.exportClause.elements) {
      if (exportSpecifier.name.text === exportName) {
        bindings.push({
          moduleSpecifier: statement.moduleSpecifier.text,
          exportName: (exportSpecifier.propertyName ?? exportSpecifier.name).text,
          isNamespace: false,
        });
      }
    }
  }
  return bindings;
};

const analyzeConfigModuleExport = (
  filePath: string,
  exportName: string,
  allowCompilerTransform: boolean,
  importDepth: number,
  visitedModules: ReadonlySet<string>,
  argumentsList: readonly ts.Expression[] = [],
): boolean => {
  if (!isFile(filePath) || importDepth > REACT_COMPILER_CONFIG_IMPORT_MAX_DEPTH) return false;
  const moduleVisitKey = `${filePath}:${exportName}:${allowCompilerTransform}`;
  if (visitedModules.has(moduleVisitKey)) return false;
  const nextVisitedModules = new Set(visitedModules);
  nextVisitedModules.add(moduleVisitKey);
  const sourceFile = parseConfigSourceFile(filePath, fs.readFileSync(filePath, "utf-8"));
  return analyzeConfigSourceFileExport(
    sourceFile,
    filePath,
    exportName,
    allowCompilerTransform,
    importDepth,
    nextVisitedModules,
    argumentsList,
  );
};

const analyzeConfigSourceFileExport = (
  sourceFile: ts.SourceFile,
  filePath: string,
  exportName: string,
  allowCompilerTransform: boolean,
  importDepth: number,
  visitedModules: ReadonlySet<string>,
  argumentsList: readonly ts.Expression[] = [],
): boolean => {
  const analysis: ConfigExpressionAnalysis = {
    filePath,
    sourceFile,
    importDepth,
    visitedModules,
    visitedNodes: new Set<string>(),
    localBindings: new Map<string, ts.Expression | null>(),
    activeFunctions: new Set<number>(),
  };
  const exportedConfigNodes = getExportedConfigNodes(sourceFile, exportName);
  return (
    exportedConfigNodes.some((node) =>
      ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node)
        ? analyzeConfigFunction(node, analysis, allowCompilerTransform, argumentsList)
        : analyzeConfigNode(node, analysis, allowCompilerTransform),
    ) ||
    getReExportedConfigModules(sourceFile, exportName).some((binding) => {
      if (exportedConfigNodes.length > 0 && binding.isNamespace) return false;
      const importedFilePath = resolveImportedConfigFile(filePath, binding.moduleSpecifier);
      return Boolean(
        importedFilePath &&
        analyzeConfigModuleExport(
          importedFilePath,
          binding.exportName,
          allowCompilerTransform,
          importDepth + 1,
          visitedModules,
          argumentsList,
        ),
      );
    })
  );
};

const analyzeConfigFunction = (
  functionNode: ts.FunctionLikeDeclaration,
  analysis: ConfigExpressionAnalysis,
  allowCompilerTransform: boolean,
  argumentsList: readonly ts.Expression[] = [],
): boolean => {
  if (!functionNode.body) return false;
  if (analysis.activeFunctions.has(functionNode.pos)) return false;
  const activeFunctions = new Set(analysis.activeFunctions);
  activeFunctions.add(functionNode.pos);
  const functionAnalysis: ConfigExpressionAnalysis = {
    ...analysis,
    visitedNodes: new Set<string>(),
    localBindings: getFunctionLocalBindings(functionNode, argumentsList),
    activeFunctions,
  };
  if (!ts.isBlock(functionNode.body)) {
    return analyzeConfigNode(functionNode.body, functionAnalysis, allowCompilerTransform);
  }
  let hasCompiler = false;
  const visitReturns = (node: ts.Node): void => {
    if (hasCompiler || (node !== functionNode.body && ts.isFunctionLike(node))) return;
    if (ts.isReturnStatement(node) && node.expression) {
      hasCompiler = analyzeConfigNode(node.expression, functionAnalysis, allowCompilerTransform);
      return;
    }
    ts.forEachChild(node, visitReturns);
  };
  visitReturns(functionNode.body);
  return hasCompiler;
};

const analyzeConfigIdentifier = (
  identifier: ts.Identifier,
  analysis: ConfigExpressionAnalysis,
  allowCompilerTransform: boolean,
  isCompilerTransformCollection: boolean,
  excludedPropertyNames?: ReadonlySet<string>,
): boolean => {
  const assignedReactCompiler = getAssignedPropertyInitializer(identifier, "reactCompiler");
  if (
    assignedReactCompiler.initializer &&
    !isStaticallyDisabledConfigExpression(assignedReactCompiler.initializer, analysis)
  ) {
    return true;
  }
  const assignedPlugins = getAssignedPropertyInitializer(identifier, "plugins");
  if (
    assignedPlugins.initializer &&
    analyzeConfigNode(assignedPlugins.initializer, analysis, true, true)
  ) {
    return true;
  }
  const assignedPresets = getAssignedPropertyInitializer(identifier, "presets");
  if (
    assignedPresets.initializer &&
    analyzeConfigNode(assignedPresets.initializer, analysis, true, true)
  ) {
    return true;
  }
  const overriddenPropertyNames = new Set(excludedPropertyNames);
  if (assignedReactCompiler.wasFound) overriddenPropertyNames.add("reactCompiler");
  if (assignedPlugins.wasFound) overriddenPropertyNames.add("plugins");
  if (assignedPresets.wasFound) overriddenPropertyNames.add("presets");
  if (analysis.localBindings.has(identifier.text)) {
    const localInitializer = analysis.localBindings.get(identifier.text);
    return Boolean(
      localInitializer &&
      analyzeConfigNode(
        localInitializer,
        analysis,
        allowCompilerTransform,
        isCompilerTransformCollection,
        overriddenPropertyNames,
      ),
    );
  }
  const scopedBinding = getScopedConfigBinding(identifier);
  if (scopedBinding.wasFound) {
    return Boolean(
      scopedBinding.initializer &&
      analyzeConfigNode(
        scopedBinding.initializer,
        analysis,
        allowCompilerTransform,
        isCompilerTransformCollection,
        overriddenPropertyNames,
      ),
    );
  }
  const importBinding = getImportBinding(analysis.sourceFile, identifier.text);
  if (importBinding) {
    if (
      allowCompilerTransform &&
      isCompilerTransformModule(importBinding.moduleSpecifier, importBinding.exportName)
    ) {
      return true;
    }
    if (!importBinding.moduleSpecifier.startsWith(".")) return false;
    const importedFilePath = resolveImportedConfigFile(
      analysis.filePath,
      importBinding.moduleSpecifier,
    );
    return Boolean(
      importedFilePath &&
      analyzeConfigModuleExport(
        importedFilePath,
        importBinding.exportName,
        allowCompilerTransform,
        analysis.importDepth + 1,
        analysis.visitedModules,
      ),
    );
  }
  const topLevelBinding = getTopLevelBinding(analysis.sourceFile, identifier.text);
  return Boolean(
    topLevelBinding &&
    analyzeConfigNode(
      topLevelBinding,
      analysis,
      allowCompilerTransform,
      isCompilerTransformCollection,
      overriddenPropertyNames,
    ),
  );
};

const analyzeConfigCallTarget = (
  callExpression: ts.CallExpression,
  analysis: ConfigExpressionAnalysis,
  allowCompilerTransform: boolean,
): boolean | null => {
  const target = callExpression.expression;
  if (!ts.isPropertyAccessExpression(target) && !ts.isElementAccessExpression(target)) return null;
  const propertyName = ts.isPropertyAccessExpression(target)
    ? target.name.text
    : target.argumentExpression && ts.isStringLiteralLike(target.argumentExpression)
      ? target.argumentExpression.text
      : null;
  if (propertyName === null) return null;

  const requiredModuleSpecifier = getRequireModuleSpecifier(target.expression);
  if (requiredModuleSpecifier !== null) {
    const isRequireShadowed =
      ts.isCallExpression(target.expression) &&
      ts.isIdentifier(target.expression.expression) &&
      (getScopedConfigBinding(target.expression.expression).wasFound ||
        hasTopLevelValueBinding(analysis.sourceFile, "require"));
    if (isRequireShadowed) return false;
    if (!requiredModuleSpecifier.startsWith(".")) return null;
    const importedFilePath = resolveImportedConfigFile(analysis.filePath, requiredModuleSpecifier);
    return Boolean(
      importedFilePath &&
      analyzeConfigModuleExport(
        importedFilePath,
        propertyName,
        allowCompilerTransform,
        analysis.importDepth + 1,
        analysis.visitedModules,
        callExpression.arguments,
      ),
    );
  }

  if (!ts.isIdentifier(target.expression)) return null;
  const importBinding = getImportBinding(analysis.sourceFile, target.expression.text);
  if (importBinding?.isNamespace && importBinding.moduleSpecifier.startsWith(".")) {
    const importedFilePath = resolveImportedConfigFile(
      analysis.filePath,
      importBinding.moduleSpecifier,
    );
    return Boolean(
      importedFilePath &&
      analyzeConfigModuleExport(
        importedFilePath,
        propertyName,
        allowCompilerTransform,
        analysis.importDepth + 1,
        analysis.visitedModules,
        callExpression.arguments,
      ),
    );
  }

  const selectedProperty = getSelectedObjectProperty(target.expression, propertyName, analysis);
  if (selectedProperty === null) return null;
  return ts.isFunctionLike(selectedProperty)
    ? analyzeConfigFunction(
        selectedProperty,
        analysis,
        allowCompilerTransform,
        callExpression.arguments,
      )
    : analyzeConfigNode(selectedProperty, analysis, allowCompilerTransform);
};

const analyzeConfigNode = (
  node: ts.Node,
  analysis: ConfigExpressionAnalysis,
  allowCompilerTransform: boolean,
  isCompilerTransformCollection = false,
  excludedPropertyNames?: ReadonlySet<string>,
): boolean => {
  const excludedPropertiesVisitKey = excludedPropertyNames
    ? [...excludedPropertyNames].sort().join(",")
    : "";
  const nodeVisitKey = `${node.pos}:${node.end}:${allowCompilerTransform}:${isCompilerTransformCollection}:${excludedPropertiesVisitKey}`;
  if (analysis.visitedNodes.has(nodeVisitKey)) return false;
  analysis.visitedNodes.add(nodeVisitKey);

  if (ts.isIdentifier(node)) {
    return analyzeConfigIdentifier(
      node,
      analysis,
      allowCompilerTransform,
      isCompilerTransformCollection,
      excludedPropertyNames,
    );
  }
  if (ts.isStringLiteralLike(node)) {
    return (
      allowCompilerTransform &&
      (node.text === "babel-plugin-react-compiler" || node.text === "react-compiler")
    );
  }
  if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isAwaitExpression(node)
  ) {
    return analyzeConfigNode(
      node.expression,
      analysis,
      allowCompilerTransform,
      isCompilerTransformCollection,
      excludedPropertyNames,
    );
  }
  if (ts.isObjectLiteralExpression(node)) {
    const reactCompilerFlagState = excludedPropertyNames?.has("reactCompiler")
      ? null
      : getReactCompilerFlagState(node, analysis);
    if (reactCompilerFlagState?.isEnabled) return true;
    for (const [propertyIndex, property] of node.properties.entries()) {
      if (ts.isPropertyAssignment(property)) {
        const propertyName = getStaticPropertyName(property.name);
        if (propertyName && excludedPropertyNames?.has(propertyName)) continue;
        if (propertyName === "reactCompiler") continue;
        if (
          (propertyName === "plugins" || propertyName === "presets") &&
          node.properties
            .slice(propertyIndex + 1)
            .some(
              (laterProperty) =>
                (ts.isSpreadAssignment(laterProperty) &&
                  configExpressionMayDefineProperty(
                    laterProperty.expression,
                    propertyName,
                    analysis,
                  )) ||
                ((ts.isPropertyAssignment(laterProperty) ||
                  ts.isShorthandPropertyAssignment(laterProperty)) &&
                  getStaticPropertyName(laterProperty.name) === propertyName),
            )
        ) {
          continue;
        }
        const propertyAllowsCompilerTransform =
          propertyName === "plugins" || propertyName === "presets";
        if (
          propertyName === "extends" &&
          ts.isStringLiteralLike(property.initializer) &&
          property.initializer.text.startsWith(".")
        ) {
          const extendedFilePath = resolveImportedConfigFile(
            analysis.filePath,
            property.initializer.text,
          );
          if (
            extendedFilePath &&
            analyzeConfigModuleExport(
              extendedFilePath,
              "default",
              false,
              analysis.importDepth + 1,
              analysis.visitedModules,
            )
          ) {
            return true;
          }
        }
        if (
          analyzeConfigNode(
            property.initializer,
            analysis,
            propertyAllowsCompilerTransform,
            propertyAllowsCompilerTransform,
          )
        )
          return true;
      } else if (ts.isShorthandPropertyAssignment(property)) {
        if (excludedPropertyNames?.has(property.name.text)) continue;
        if (property.name.text === "reactCompiler") continue;
        if (
          (property.name.text === "plugins" || property.name.text === "presets") &&
          node.properties
            .slice(propertyIndex + 1)
            .some(
              (laterProperty) =>
                (ts.isSpreadAssignment(laterProperty) &&
                  configExpressionMayDefineProperty(
                    laterProperty.expression,
                    property.name.text,
                    analysis,
                  )) ||
                ((ts.isPropertyAssignment(laterProperty) ||
                  ts.isShorthandPropertyAssignment(laterProperty)) &&
                  getStaticPropertyName(laterProperty.name) === property.name.text),
            )
        ) {
          continue;
        }
        const propertyAllowsCompilerTransform =
          property.name.text === "plugins" || property.name.text === "presets";
        if (
          analyzeConfigNode(
            property.name,
            analysis,
            propertyAllowsCompilerTransform,
            propertyAllowsCompilerTransform,
          )
        )
          return true;
      } else if (ts.isSpreadAssignment(property)) {
        if (
          reactCompilerFlagState &&
          getReactCompilerFlagState(property.expression, analysis) !== null
        ) {
          continue;
        }
        if (
          node.properties
            .slice(propertyIndex + 1)
            .some(
              (laterProperty) =>
                (ts.isPropertyAssignment(laterProperty) ||
                  ts.isShorthandPropertyAssignment(laterProperty)) &&
                (getStaticPropertyName(laterProperty.name) === "plugins" ||
                  getStaticPropertyName(laterProperty.name) === "presets"),
            )
        ) {
          continue;
        }
        if (
          analyzeConfigNode(
            property.expression,
            analysis,
            allowCompilerTransform,
            false,
            excludedPropertyNames,
          )
        ) {
          return true;
        }
      }
    }
    return false;
  }
  if (ts.isArrayLiteralExpression(node)) {
    if (isCompilerTransformCollection) {
      return node.elements.some((element) =>
        analyzeConfigNode(
          ts.isSpreadElement(element) ? element.expression : element,
          analysis,
          allowCompilerTransform,
          ts.isSpreadElement(element),
        ),
      );
    }
    const isTransformTuple =
      allowCompilerTransform &&
      node.elements.length > 1 &&
      ts.isStringLiteralLike(node.elements[0]) &&
      node.elements[0].text !== "babel-plugin-react-compiler" &&
      node.elements[0].text !== "react-compiler";
    return node.elements.some((element, elementIndex) => {
      const expression = ts.isSpreadElement(element) ? element.expression : element;
      return analyzeConfigNode(
        expression,
        analysis,
        allowCompilerTransform && (!isTransformTuple || elementIndex === 0),
      );
    });
  }
  if (ts.isCallExpression(node)) {
    const callTargetResult = analyzeConfigCallTarget(node, analysis, allowCompilerTransform);
    if (callTargetResult !== null) return callTargetResult;
    const directModuleSpecifier = getRequireModuleSpecifier(node);
    const isRequireShadowed =
      analysis.localBindings.has("require") ||
      (ts.isIdentifier(node.expression) && getScopedConfigBinding(node.expression).wasFound) ||
      hasTopLevelValueBinding(analysis.sourceFile, "require");
    if (directModuleSpecifier && isRequireShadowed) {
      return analyzeConfigNode(node.expression, analysis, allowCompilerTransform);
    }
    if (directModuleSpecifier && !isRequireShadowed) {
      if (allowCompilerTransform && isCompilerTransformModule(directModuleSpecifier, "default"))
        return true;
      if (directModuleSpecifier.startsWith(".")) {
        const importedFilePath = resolveImportedConfigFile(
          analysis.filePath,
          directModuleSpecifier,
        );
        if (
          importedFilePath &&
          analyzeConfigModuleExport(
            importedFilePath,
            "default",
            allowCompilerTransform,
            analysis.importDepth + 1,
            analysis.visitedModules,
          )
        ) {
          return true;
        }
      }
    }
    if (ts.isIdentifier(node.expression)) {
      const importBinding = getImportBinding(analysis.sourceFile, node.expression.text);
      if (importBinding?.moduleSpecifier.startsWith(".")) {
        const importedFilePath = resolveImportedConfigFile(
          analysis.filePath,
          importBinding.moduleSpecifier,
        );
        return Boolean(
          importedFilePath &&
          analyzeConfigModuleExport(
            importedFilePath,
            importBinding.exportName,
            allowCompilerTransform,
            analysis.importDepth + 1,
            analysis.visitedModules,
            node.arguments,
          ),
        );
      }
      const topLevelBinding = getTopLevelBinding(analysis.sourceFile, node.expression.text);
      if (
        topLevelBinding &&
        ts.isFunctionLike(topLevelBinding) &&
        analyzeConfigFunction(topLevelBinding, analysis, allowCompilerTransform, node.arguments)
      ) {
        return true;
      }
    }
    return (
      analyzeConfigNode(node.expression, analysis, allowCompilerTransform) ||
      node.arguments.some((argument) => analyzeConfigNode(argument, analysis, false))
    );
  }
  if (ts.isPropertyAccessExpression(node)) {
    const requiredModuleSpecifier = getRequireModuleSpecifier(node.expression);
    if (requiredModuleSpecifier) {
      const isRequireShadowed =
        ts.isCallExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        (getScopedConfigBinding(node.expression.expression).wasFound ||
          hasTopLevelValueBinding(analysis.sourceFile, "require"));
      if (isRequireShadowed) return false;
      if (requiredModuleSpecifier.startsWith(".")) {
        const importedFilePath = resolveImportedConfigFile(
          analysis.filePath,
          requiredModuleSpecifier,
        );
        return Boolean(
          importedFilePath &&
          analyzeConfigModuleExport(
            importedFilePath,
            node.name.text,
            allowCompilerTransform,
            analysis.importDepth + 1,
            analysis.visitedModules,
          ),
        );
      }
      return (
        allowCompilerTransform && isCompilerTransformModule(requiredModuleSpecifier, node.name.text)
      );
    }
    if (ts.isIdentifier(node.expression)) {
      if (analysis.localBindings.has(node.expression.text)) {
        const localInitializer = analysis.localBindings.get(node.expression.text);
        return Boolean(
          localInitializer && analyzeConfigNode(localInitializer, analysis, allowCompilerTransform),
        );
      }
      const importBinding = getImportBinding(analysis.sourceFile, node.expression.text);
      if (importBinding?.isNamespace) {
        if (
          allowCompilerTransform &&
          isCompilerTransformModule(importBinding.moduleSpecifier, node.name.text)
        ) {
          return true;
        }
        if (importBinding.moduleSpecifier.startsWith(".")) {
          const importedFilePath = resolveImportedConfigFile(
            analysis.filePath,
            importBinding.moduleSpecifier,
          );
          if (
            importedFilePath &&
            analyzeConfigModuleExport(
              importedFilePath,
              node.name.text,
              allowCompilerTransform,
              analysis.importDepth + 1,
              analysis.visitedModules,
            )
          ) {
            return true;
          }
        }
        return false;
      }
      const selectedProperty = getSelectedObjectProperty(node.expression, node.name.text, analysis);
      if (selectedProperty) {
        return analyzeConfigNode(selectedProperty, analysis, allowCompilerTransform);
      }
      return false;
    }
    return analyzeConfigNode(node.expression, analysis, allowCompilerTransform);
  }
  if (
    ts.isElementAccessExpression(node) &&
    node.argumentExpression &&
    ts.isStringLiteralLike(node.argumentExpression)
  ) {
    if (ts.isIdentifier(node.expression)) {
      const importBinding = getImportBinding(analysis.sourceFile, node.expression.text);
      if (importBinding?.isNamespace) {
        if (
          allowCompilerTransform &&
          isCompilerTransformModule(importBinding.moduleSpecifier, node.argumentExpression.text)
        ) {
          return true;
        }
        if (importBinding.moduleSpecifier.startsWith(".")) {
          const importedFilePath = resolveImportedConfigFile(
            analysis.filePath,
            importBinding.moduleSpecifier,
          );
          return Boolean(
            importedFilePath &&
            analyzeConfigModuleExport(
              importedFilePath,
              node.argumentExpression.text,
              allowCompilerTransform,
              analysis.importDepth + 1,
              analysis.visitedModules,
            ),
          );
        }
      }
      const selectedProperty = getSelectedObjectProperty(
        node.expression,
        node.argumentExpression.text,
        analysis,
      );
      if (selectedProperty) {
        return analyzeConfigNode(selectedProperty, analysis, allowCompilerTransform);
      }
      return false;
    }
    return analyzeConfigNode(node.expression, analysis, allowCompilerTransform);
  }
  if (ts.isBinaryExpression(node)) {
    if (node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      return (
        !isStaticallyDisabledConfigExpression(node.left, analysis) &&
        analyzeConfigNode(
          node.right,
          analysis,
          allowCompilerTransform,
          isCompilerTransformCollection,
        )
      );
    }
    if (node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const leftText = node.left.getText(analysis.sourceFile);
      const assignedPropertyName = ts.isPropertyAccessExpression(node.left)
        ? node.left.name.text
        : ts.isElementAccessExpression(node.left) &&
            node.left.argumentExpression &&
            ts.isStringLiteralLike(node.left.argumentExpression)
          ? node.left.argumentExpression.text
          : null;
      if (assignedPropertyName === "reactCompiler" || leftText.endsWith(".reactCompiler")) {
        return !isStaticallyDisabledConfigExpression(node.right, analysis);
      }
      if (
        assignedPropertyName === "plugins" ||
        assignedPropertyName === "presets" ||
        leftText.endsWith(".plugins") ||
        leftText.endsWith(".presets")
      ) {
        return analyzeConfigNode(node.right, analysis, true, true);
      }
      return analyzeConfigNode(node.right, analysis, allowCompilerTransform);
    }
    if (node.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
      if (isStaticallyTruthyConfigExpression(node.left, analysis)) {
        return analyzeConfigNode(
          node.left,
          analysis,
          allowCompilerTransform,
          isCompilerTransformCollection,
        );
      }
      if (isStaticallyDisabledConfigExpression(node.left, analysis)) {
        return analyzeConfigNode(
          node.right,
          analysis,
          allowCompilerTransform,
          isCompilerTransformCollection,
        );
      }
      return (
        analyzeConfigNode(
          node.left,
          analysis,
          allowCompilerTransform,
          isCompilerTransformCollection,
        ) ||
        analyzeConfigNode(
          node.right,
          analysis,
          allowCompilerTransform,
          isCompilerTransformCollection,
        )
      );
    }
    if (node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
      if (isStaticallyNullishConfigExpression(node.left, analysis)) {
        return analyzeConfigNode(
          node.right,
          analysis,
          allowCompilerTransform,
          isCompilerTransformCollection,
        );
      }
      if (isStaticallyNonNullishConfigExpression(node.left, analysis)) {
        return analyzeConfigNode(
          node.left,
          analysis,
          allowCompilerTransform,
          isCompilerTransformCollection,
        );
      }
      return (
        analyzeConfigNode(
          node.left,
          analysis,
          allowCompilerTransform,
          isCompilerTransformCollection,
        ) ||
        analyzeConfigNode(
          node.right,
          analysis,
          allowCompilerTransform,
          isCompilerTransformCollection,
        )
      );
    }
  }
  if (ts.isConditionalExpression(node)) {
    if (isStaticallyTruthyConfigExpression(node.condition, analysis)) {
      return analyzeConfigNode(
        node.whenTrue,
        analysis,
        allowCompilerTransform,
        isCompilerTransformCollection,
      );
    }
    if (isStaticallyDisabledConfigExpression(node.condition, analysis)) {
      return analyzeConfigNode(
        node.whenFalse,
        analysis,
        allowCompilerTransform,
        isCompilerTransformCollection,
      );
    }
    return (
      analyzeConfigNode(
        node.whenTrue,
        analysis,
        allowCompilerTransform,
        isCompilerTransformCollection,
      ) ||
      analyzeConfigNode(
        node.whenFalse,
        analysis,
        allowCompilerTransform,
        isCompilerTransformCollection,
      )
    );
  }
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node)) {
    return analyzeConfigFunction(node, analysis, allowCompilerTransform);
  }
  return false;
};

const hasCompilerInConfigFile = (filePath: string): boolean =>
  analyzeConfigModuleExport(filePath, "default", false, 0, new Set<string>());

const hasCompilerInConfigFiles = (directory: string, filenames: string[]): boolean =>
  filenames.some((filename) => hasCompilerInConfigFile(path.join(directory, filename)));

const hasCompilerInPackageJsonConfig = (packageJson: PackageJson): boolean =>
  isPlainObject(packageJson.babel) &&
  analyzeConfigSourceFileExport(
    ts.parseJsonText("package.json", JSON.stringify(packageJson.babel)),
    "package.json#babel",
    "default",
    false,
    0,
    new Set<string>(),
  );

const hasCompilerConfiguration = (directory: string, packageJson: PackageJson): boolean =>
  hasCompilerInPackageJsonConfig(packageJson) ||
  hasCompilerInConfigFiles(directory, REACT_COMPILER_CONFIG_FILENAMES);

const hasCompilerConfigurationInAncestors = (directory: string): boolean => {
  if (isProjectBoundary(directory)) return false;

  let ancestorDirectory = path.dirname(directory);
  while (ancestorDirectory !== path.dirname(ancestorDirectory)) {
    const ancestorPackagePath = path.join(ancestorDirectory, "package.json");
    const ancestorPackageJson = isFile(ancestorPackagePath)
      ? readPackageJson(ancestorPackagePath)
      : {};
    if (
      hasCompilerInPackageJsonConfig(ancestorPackageJson) ||
      hasCompilerInConfigFiles(ancestorDirectory, BABEL_CONFIG_FILENAMES)
    ) {
      return true;
    }
    if (isProjectBoundary(ancestorDirectory)) return false;
    ancestorDirectory = path.dirname(ancestorDirectory);
  }

  return false;
};

export const detectReactCompiler = (directory: string, packageJson: PackageJson): boolean =>
  hasCompilerConfiguration(directory, packageJson) ||
  hasCompilerConfigurationInAncestors(directory);

export const detectReactCompilerLintPlugin = (
  directory: string,
  packageJson: PackageJson,
): boolean =>
  hasCompilerPackage(packageJson, REACT_COMPILER_LINT_PACKAGES) ||
  hasCompilerPackageInAncestors(directory, REACT_COMPILER_LINT_PACKAGES);

// Whether `next.config.*` opts into static HTML export (`output: "export"`).
// Reuses the same next.config filenames + raw-text read as the React Compiler
// detector above (the config can be TS/ESM, so it can't be cheaply imported at
// discovery time). A per-project fact — not walked into ancestors.
export const detectNextjsStaticExport = (directory: string): boolean =>
  NEXT_CONFIG_FILENAMES.some((filename) => {
    const filePath = path.join(directory, filename);
    return (
      isFile(filePath) && STATIC_EXPORT_OUTPUT_PATTERN.test(fs.readFileSync(filePath, "utf-8"))
    );
  });
