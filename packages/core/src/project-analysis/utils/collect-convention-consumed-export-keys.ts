import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import ts from "typescript";
import type { DependencyGraph } from "../types.js";
import { toCanonicalPath } from "../../utils/to-canonical-path.js";
import { resolveEntryWithExtensions } from "./resolve-entry-with-extensions.js";
import { toPosixPath } from "./to-posix-path.js";

interface ConventionPackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
}

interface ConventionPackageMetadata {
  dependencyNames: Set<string>;
  scripts: ReadonlyArray<string>;
}

const NEXT_CONFIG_FILENAMES = [
  "next.config.ts",
  "next.config.js",
  "next.config.mjs",
  "next.config.mts",
];

const NEXT_ROUTE_SEGMENT_MODULE_PATTERN =
  /^(?:src\/)?app\/(?:.*\/)?(?:page|layout|route|default|loading|error|not-found|template|global-error|forbidden|unauthorized|opengraph-image|twitter-image|icon|apple-icon|manifest|sitemap|robots)\.(?:ts|tsx|js|jsx)$/;

const REACT_EMAIL_TEMPLATE_EXTENSION_PATTERN = /\.(?:js|jsx|tsx)$/;

const REACT_EMAIL_DEV_COMMAND_PATTERN = /(?:^|\s)email\s+dev(?:\s|$)/;

const buildExportKey = (filePath: string, exportName: string): string =>
  `${filePath}::${exportName}`;

const hasDependency = (
  packageMetadata: ConventionPackageMetadata,
  dependencyName: string,
): boolean => packageMetadata.dependencyNames.has(dependencyName);

const readPackageMetadata = (packageDirectory: string): ConventionPackageMetadata | undefined => {
  try {
    const packageJson: ConventionPackageJson = JSON.parse(
      readFileSync(resolve(packageDirectory, "package.json"), "utf-8"),
    );
    return {
      dependencyNames: new Set([
        ...Object.keys(packageJson.dependencies ?? {}),
        ...Object.keys(packageJson.devDependencies ?? {}),
        ...Object.keys(packageJson.optionalDependencies ?? {}),
        ...Object.keys(packageJson.peerDependencies ?? {}),
      ]),
      scripts: Object.values(packageJson.scripts ?? {}),
    };
  } catch {
    return undefined;
  }
};

const findOwningPackageDirectory = (
  filePath: string,
  analysisRootDirectory: string,
  packageDirectoryBySourceDirectory: Map<string, string | undefined>,
): string | undefined => {
  const resolvedAnalysisRoot = resolve(analysisRootDirectory);
  let currentDirectory = dirname(resolve(filePath));
  const visitedDirectories: string[] = [];

  while (true) {
    if (packageDirectoryBySourceDirectory.has(currentDirectory)) {
      const packageDirectory = packageDirectoryBySourceDirectory.get(currentDirectory);
      for (const visitedDirectory of visitedDirectories) {
        packageDirectoryBySourceDirectory.set(visitedDirectory, packageDirectory);
      }
      return packageDirectory;
    }
    const relativeToRoot = relative(resolvedAnalysisRoot, currentDirectory);
    if (
      relativeToRoot === ".." ||
      relativeToRoot.startsWith(`..${sep}`) ||
      isAbsolute(relativeToRoot)
    ) {
      for (const visitedDirectory of visitedDirectories) {
        packageDirectoryBySourceDirectory.set(visitedDirectory, undefined);
      }
      return undefined;
    }
    visitedDirectories.push(currentDirectory);
    if (existsSync(resolve(currentDirectory, "package.json"))) {
      for (const visitedDirectory of visitedDirectories) {
        packageDirectoryBySourceDirectory.set(visitedDirectory, currentDirectory);
      }
      return currentDirectory;
    }
    if (currentDirectory === resolvedAnalysisRoot) {
      for (const visitedDirectory of visitedDirectories) {
        packageDirectoryBySourceDirectory.set(visitedDirectory, undefined);
      }
      return undefined;
    }
    const parentDirectory = dirname(currentDirectory);
    if (parentDirectory === currentDirectory) {
      for (const visitedDirectory of visitedDirectories) {
        packageDirectoryBySourceDirectory.set(visitedDirectory, undefined);
      }
      return undefined;
    }
    currentDirectory = parentDirectory;
  }
};

const hasNextraImport = (sourceFile: ts.SourceFile): boolean =>
  sourceFile.statements.some(
    (statement) =>
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === "nextra",
  );

const collectReferencedNextraThemeConfigPaths = (packageDirectory: string): Set<string> => {
  const referencedPaths = new Set<string>();

  for (const configFilename of NEXT_CONFIG_FILENAMES) {
    const configPath = resolve(packageDirectory, configFilename);
    if (!existsSync(configPath)) continue;

    let content: string;
    try {
      content = readFileSync(configPath, "utf-8");
    } catch {
      continue;
    }

    const sourceFile = ts.createSourceFile(
      configPath,
      content,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    if (!hasNextraImport(sourceFile)) continue;

    const visitNode = (node: ts.Node): void => {
      if (ts.isPropertyAssignment(node)) {
        const propertyName =
          ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) ? node.name.text : undefined;
        if (
          propertyName === "themeConfig" &&
          (ts.isStringLiteral(node.initializer) ||
            ts.isNoSubstitutionTemplateLiteral(node.initializer)) &&
          node.initializer.text.startsWith(".")
        ) {
          const resolvedThemeConfigPath = resolveEntryWithExtensions(
            resolve(dirname(configPath), node.initializer.text),
          );
          if (resolvedThemeConfigPath) {
            referencedPaths.add(toPosixPath(resolve(resolvedThemeConfigPath)));
          }
        }
      }
      ts.forEachChild(node, visitNode);
    };

    visitNode(sourceFile);
  }

  return referencedPaths;
};

const isReactEmailDevTemplate = (
  packageRelativePath: string,
  packageMetadata: ConventionPackageMetadata,
): boolean => {
  if (
    !hasDependency(packageMetadata, "react-email") &&
    !hasDependency(packageMetadata, "@react-email/preview-server")
  ) {
    return false;
  }
  if (!packageMetadata.scripts.some((script) => REACT_EMAIL_DEV_COMMAND_PATTERN.test(script))) {
    return false;
  }
  const pathSegments = packageRelativePath.split("/");
  if (pathSegments[0] !== "emails" || pathSegments[1] !== "templates") return false;
  if (pathSegments.slice(2, -1).some((pathSegment) => pathSegment.startsWith("_"))) {
    return false;
  }
  return REACT_EMAIL_TEMPLATE_EXTENSION_PATTERN.test(packageRelativePath);
};

export const collectConventionConsumedExportKeys = (
  graph: DependencyGraph,
  analysisRootDirectory: string,
): Set<string> => {
  const consumedExportKeys = new Set<string>();
  const packageMetadataByDirectory = new Map<string, ConventionPackageMetadata | undefined>();
  const packageDirectoryBySourceDirectory = new Map<string, string | undefined>();
  const themeConfigPathsByPackageDirectory = new Map<string, ReadonlySet<string>>();
  const canonicalAnalysisRootDirectory = toCanonicalPath(resolve(analysisRootDirectory));

  for (const module of graph.modules) {
    const resolvedModuleFilePath = resolve(module.fileId.path);
    const relativeModulePath = relative(canonicalAnalysisRootDirectory, resolvedModuleFilePath);
    const isModulePathInsideCanonicalRoot =
      relativeModulePath !== ".." &&
      !relativeModulePath.startsWith(`..${sep}`) &&
      !isAbsolute(relativeModulePath);
    const canonicalModuleFilePath = isModulePathInsideCanonicalRoot
      ? resolvedModuleFilePath
      : toCanonicalPath(resolvedModuleFilePath);
    const packageDirectory = findOwningPackageDirectory(
      canonicalModuleFilePath,
      canonicalAnalysisRootDirectory,
      packageDirectoryBySourceDirectory,
    );
    if (!packageDirectory) continue;

    if (!packageMetadataByDirectory.has(packageDirectory)) {
      packageMetadataByDirectory.set(packageDirectory, readPackageMetadata(packageDirectory));
    }
    const packageMetadata = packageMetadataByDirectory.get(packageDirectory);
    if (!packageMetadata) continue;

    const packageRelativePath = toPosixPath(relative(packageDirectory, canonicalModuleFilePath));
    const isNextRouteSegmentModule =
      hasDependency(packageMetadata, "next") &&
      NEXT_ROUTE_SEGMENT_MODULE_PATTERN.test(packageRelativePath);
    const isContentCollectionsConfig =
      hasDependency(packageMetadata, "@content-collections/core") &&
      packageRelativePath === "content-collections.ts";
    const isReactEmailTemplate = isReactEmailDevTemplate(packageRelativePath, packageMetadata);

    let isReferencedNextraThemeConfig = false;
    if (
      hasDependency(packageMetadata, "nextra") &&
      basename(canonicalModuleFilePath) === "theme.config.tsx"
    ) {
      if (!themeConfigPathsByPackageDirectory.has(packageDirectory)) {
        themeConfigPathsByPackageDirectory.set(
          packageDirectory,
          collectReferencedNextraThemeConfigPaths(packageDirectory),
        );
      }
      isReferencedNextraThemeConfig = Boolean(
        themeConfigPathsByPackageDirectory
          .get(packageDirectory)
          ?.has(toPosixPath(canonicalModuleFilePath)),
      );
    }

    for (const exportInfo of module.exports) {
      if (
        (isNextRouteSegmentModule && exportInfo.name === "runtime") ||
        (exportInfo.isDefault &&
          (isContentCollectionsConfig || isReactEmailTemplate || isReferencedNextraThemeConfig))
      ) {
        consumedExportKeys.add(buildExportKey(module.fileId.path, exportInfo.name));
      }
    }
  }

  return consumedExportKeys;
};
