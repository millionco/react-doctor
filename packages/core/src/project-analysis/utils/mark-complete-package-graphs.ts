import { builtinModules } from "node:module";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import ts from "typescript";
import {
  UNUSED_FILE_INCOMPLETE_CONTAINER_EXTENSIONS,
  UNUSED_FILE_UNSUPPORTED_FRAMEWORK_DEPENDENCIES,
} from "../constants.js";
import type { DependencyGraph, ProjectAnalysisError, SourceModule } from "../types.js";
import { isPathInsideDirectoryOrEqual } from "./is-path-inside-directory-or-equal.js";
import { findNearestPackageDirectory } from "./find-nearest-package-directory.js";
import { getFileIdentityKey } from "./get-file-identity-key.js";
import { toFilesystemIdentityPath } from "./to-filesystem-identity-path.js";

export interface MarkCompletePackageGraphsInput {
  graph: DependencyGraph;
  packageRootDirectories: ReadonlyArray<string>;
  resolvedLocalImportSpecifiersByFilePath: ReadonlyMap<string, ReadonlySet<string>>;
  unresolvedImportingFilePaths: ReadonlySet<string>;
  setupErrors: ReadonlyArray<ProjectAnalysisError>;
}

interface PackageContract {
  declaredDependencies: Set<string>;
  hasUnsupportedAutomaticContract: boolean;
}

const BUILTIN_MODULE_SPECIFIERS = new Set([
  ...builtinModules,
  ...builtinModules.map((moduleName) => `node:${moduleName}`),
]);

const packageNameFromSpecifier = (specifier: string): string =>
  specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0];

const UNSUPPORTED_BUILD_DEPENDENCIES = [
  "@remix-run/dev",
  "@react-router/dev",
  "astro",
  "cypress",
  "electron",
  "esbuild",
  "expo",
  "gatsby",
  "gulp",
  "jest",
  "nuxt",
  "parcel",
  "playwright",
  "react-native",
  "react-app-rewired",
  "@craco/craco",
  "rollup",
  "rspack",
  "rsbuild",
  "storybook",
  "vite",
  "vitest",
  "webpack",
];

const UNSUPPORTED_RUNTIME_CONFIG_PATTERN =
  /^(?:astro|craco|cypress|electron-builder|esbuild|forge|gatsby|jest|next|nuxt|playwright|react-router|remix|rollup|rspack|rsbuild|svelte|vite|vitest|webpack)(?:\.[^.]+)*\.config\.[cm]?[jt]s$|^(?:config-overrides|gulpfile|gruntfile)(?:\.[^.]+)*\.[cm]?[jt]s$/i;

const isSupportedAutomaticScript = (script: unknown): boolean =>
  typeof script === "string" &&
  /^(?:(?:[A-Z_][A-Z0-9_]*=[^\s]+\s+)*)(?:next|react-scripts)\s+(?:dev|build|start|test|eject)$/.test(
    script.trim(),
  );

const readPackageContract = (packageRootDirectory: string): PackageContract | undefined => {
  const packageJsonPath = join(packageRootDirectory, "package.json");
  if (!existsSync(packageJsonPath)) return undefined;
  try {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    const declaredDependencies = new Set([
      ...Object.keys(packageJson.dependencies ?? {}),
      ...Object.keys(packageJson.devDependencies ?? {}),
      ...Object.keys(packageJson.peerDependencies ?? {}),
      ...Object.keys(packageJson.optionalDependencies ?? {}),
    ]);
    const packageEntryValues = JSON.stringify({
      exports: packageJson.exports,
      sideEffects: packageJson.sideEffects,
    });
    const scripts = Object.values(packageJson.scripts ?? {});
    const rootFileNames = readdirSync(packageRootDirectory);
    const hasUnsupportedAutomaticContract =
      packageEntryValues.includes("*") ||
      scripts.some((script) => !isSupportedAutomaticScript(script)) ||
      UNSUPPORTED_BUILD_DEPENDENCIES.some((dependencyName) =>
        declaredDependencies.has(dependencyName),
      ) ||
      rootFileNames.some((fileName) => UNSUPPORTED_RUNTIME_CONFIG_PATTERN.test(fileName)) ||
      existsSync(join(packageRootDirectory, ".storybook"));
    return { declaredDependencies, hasUnsupportedAutomaticContract };
  } catch {
    return undefined;
  }
};

const isSupportedAutomaticEntry = (
  filePath: string,
  packageRootDirectory: string,
  declaredDependencies: ReadonlySet<string>,
): boolean => {
  const relativePath = relative(packageRootDirectory, filePath).replaceAll("\\", "/");
  if (
    declaredDependencies.has("react-scripts") &&
    /^src\/index\.[cm]?[jt]sx?$/.test(relativePath)
  ) {
    return true;
  }
  if (!declaredDependencies.has("next")) return false;
  return (
    /^(?:src\/)?app\/(?:.*\/)?(?:page|layout|route|loading|error|template|default|not-found|global-error)\.[cm]?[jt]sx?$/.test(
      relativePath,
    ) || /^(?:src\/)?pages\/(?!_components\/).+\.[cm]?[jt]sx?$/.test(relativePath)
  );
};

const hasUnparseableCompilerConfig = (packageRootDirectory: string): boolean => {
  let configNames: string[];
  try {
    configNames = readdirSync(packageRootDirectory).filter((fileName) =>
      /^(?:tsconfig|jsconfig)(?:\.[^.]+)*\.json$/.test(fileName),
    );
  } catch {
    return true;
  }
  return configNames.some((configName) => {
    const configPath = join(packageRootDirectory, configName);
    try {
      return (
        ts.parseConfigFileTextToJson(configPath, readFileSync(configPath, "utf8")).error !==
        undefined
      );
    } catch {
      return true;
    }
  });
};

const hasUnresolvedUndeclaredBareImport = (
  module: SourceModule,
  declaredDependencies: ReadonlySet<string>,
  resolvedLocalImportSpecifiers: ReadonlySet<string>,
): boolean =>
  module.imports.some((importReference) => {
    const { specifier } = importReference;
    if (
      resolvedLocalImportSpecifiers.has(specifier) ||
      specifier.startsWith(".") ||
      isAbsolute(specifier) ||
      specifier.startsWith("http:") ||
      specifier.startsWith("https:") ||
      specifier.startsWith("data:") ||
      BUILTIN_MODULE_SPECIFIERS.has(specifier)
    ) {
      return false;
    }
    return !declaredDependencies.has(packageNameFromSpecifier(specifier));
  });

const TEST_OR_STORY_FILE_PATTERN =
  /(?:^|\/)(?:tests?|__tests__|e2e|cypress|playwright|stories|storybook)(?:\/|$)|\.(?:test|spec|stories|story|cy)\./i;

export const markCompletePackageGraphs = ({
  graph,
  packageRootDirectories,
  resolvedLocalImportSpecifiersByFilePath,
  unresolvedImportingFilePaths,
  setupErrors,
}: MarkCompletePackageGraphsInput): void => {
  const sortedPackageRoots = [
    ...new Set(packageRootDirectories.map(toFilesystemIdentityPath)),
  ].toSorted((leftDirectory, rightDirectory) => rightDirectory.length - leftDirectory.length);
  const canonicalPathBySetupError = new Map(
    setupErrors.flatMap((error) =>
      error.path === undefined ? [] : [[error, toFilesystemIdentityPath(error.path)]],
    ),
  );
  const packageManifestIdentityByRoot = new Map(
    sortedPackageRoots.map((packageRootDirectory) => [
      packageRootDirectory,
      getFileIdentityKey(join(packageRootDirectory, "package.json")),
    ]),
  );
  const canonicalFilePathByModule = new Map(
    graph.modules.map((module) => [module, toFilesystemIdentityPath(module.fileId.path)]),
  );
  const owningPackageDirectoryByModule = new Map(
    graph.modules.map((module) => [
      module,
      findNearestPackageDirectory(canonicalFilePathByModule.get(module) ?? module.fileId.path),
    ]),
  );
  const rootPackageContract = readPackageContract(
    sortedPackageRoots[sortedPackageRoots.length - 1] ?? "",
  );
  for (const packageRootDirectory of sortedPackageRoots) {
    const packageModules = graph.modules.filter((module) => {
      const owningPackageDirectory = owningPackageDirectoryByModule.get(module);
      return (
        owningPackageDirectory !== undefined &&
        getFileIdentityKey(join(owningPackageDirectory, "package.json")) ===
          packageManifestIdentityByRoot.get(packageRootDirectory)
      );
    });
    const packageContract = readPackageContract(packageRootDirectory);
    const declaredDependencies = new Set([
      ...(rootPackageContract?.declaredDependencies ?? []),
      ...(packageContract?.declaredDependencies ?? []),
    ]);
    const hasExplicitEntry = packageModules.some((module) => module.isExplicitEntryPoint);
    const hasSupportedAutomaticEntry = packageModules.some(
      (module) =>
        module.isAuthoritativeEntryPoint &&
        isSupportedAutomaticEntry(
          canonicalFilePathByModule.get(module) ?? module.fileId.path,
          owningPackageDirectoryByModule.get(module) ?? packageRootDirectory,
          declaredDependencies,
        ),
    );
    const hasParseOrReadUncertainty = packageModules.some(
      (module) => !module.isAnalysisExcluded && module.parseErrors.length > 0,
    );
    const hasResolutionUncertainty = packageModules.some((module) =>
      unresolvedImportingFilePaths.has(module.fileId.path),
    );
    const hasDynamicLoaderUncertainty = packageModules.some(
      (module) => !module.isAnalysisExcluded && module.hasUnknownDynamicModuleLoad,
    );
    const hasContainerUncertainty = packageModules.some(
      (module) =>
        !module.isAnalysisExcluded &&
        UNUSED_FILE_INCOMPLETE_CONTAINER_EXTENSIONS.some((extension) =>
          module.fileId.path.endsWith(extension),
        ),
    );
    const hasFrameworkUncertainty = UNUSED_FILE_UNSUPPORTED_FRAMEWORK_DEPENDENCIES.some(
      (dependencyName) => declaredDependencies.has(dependencyName),
    );
    const hasCompilerConfigUncertainty = hasUnparseableCompilerConfig(packageRootDirectory);
    const hasAliasUncertainty = packageModules.some(
      (module) =>
        !module.isAnalysisExcluded &&
        hasUnresolvedUndeclaredBareImport(
          module,
          declaredDependencies,
          resolvedLocalImportSpecifiersByFilePath.get(module.fileId.path) ?? new Set(),
        ),
    );
    const hasTestOrStoryContract = graph.modules.some(
      (module) =>
        TEST_OR_STORY_FILE_PATTERN.test(module.fileId.path.replaceAll("\\", "/")) &&
        isPathInsideDirectoryOrEqual(
          canonicalFilePathByModule.get(module) ?? module.fileId.path,
          packageRootDirectory,
        ),
    );
    const hasSetupUncertainty = setupErrors.some(
      (error) =>
        error.severity !== "info" &&
        error.code !== "gitignore-check-failed" &&
        (error.path === undefined ||
          isPathInsideDirectoryOrEqual(
            canonicalPathBySetupError.get(error) ?? error.path,
            packageRootDirectory,
          )),
    );
    const isComplete =
      !hasSetupUncertainty &&
      packageContract !== undefined &&
      (hasExplicitEntry ||
        (hasSupportedAutomaticEntry &&
          !packageContract.hasUnsupportedAutomaticContract &&
          rootPackageContract?.hasUnsupportedAutomaticContract !== true)) &&
      !hasTestOrStoryContract &&
      !hasParseOrReadUncertainty &&
      !hasResolutionUncertainty &&
      !hasDynamicLoaderUncertainty &&
      !hasContainerUncertainty &&
      !hasFrameworkUncertainty &&
      !hasCompilerConfigUncertainty &&
      !hasAliasUncertainty;
    for (const module of packageModules) {
      module.isPackageGraphComplete = isComplete;
      module.hasPackageDynamicLoaderUncertainty = hasDynamicLoaderUncertainty;
    }
  }
};
