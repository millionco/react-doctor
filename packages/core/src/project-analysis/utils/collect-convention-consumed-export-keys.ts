import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";
import ts from "typescript";
import type { DependencyGraph } from "../types.js";
import { resolveEntryWithExtensions } from "./resolve-entry-with-extensions.js";
import { toFilesystemIdentityPath } from "./to-filesystem-identity-path.js";
import { toPosixPath } from "./to-posix-path.js";
import { extractReactEmailTemplateDirectories } from "./extract-react-email-template-directories.js";
import { collectDynamicBuildConsumedExportKeys } from "./collect-dynamic-build-consumed-export-keys.js";
import { buildExportKey } from "./build-export-key.js";
import { findNearestPackageDirectory } from "./find-nearest-package-directory.js";
import { getFileIdentityKey } from "./get-file-identity-key.js";

interface ConventionPackageJson {
  cromwell?: { type?: string };
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
}

interface ConventionPackageMetadata {
  dependencyNames: Set<string>;
  isCromwellPlugin: boolean;
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
      isCromwellPlugin: packageJson.cromwell?.type === "plugin",
      scripts: Object.values(packageJson.scripts ?? {}),
    };
  } catch {
    return undefined;
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
            referencedPaths.add(
              toPosixPath(toFilesystemIdentityPath(resolve(resolvedThemeConfigPath))),
            );
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
  const templateDirectories = extractReactEmailTemplateDirectories(packageMetadata.scripts);
  return templateDirectories.some((templateDirectory) => {
    const normalizedTemplateDirectory = toPosixPath(templateDirectory).replace(/^\.\//, "");
    if (!packageRelativePath.startsWith(`${normalizedTemplateDirectory}/`)) return false;
    const relativeTemplatePath = packageRelativePath.slice(normalizedTemplateDirectory.length + 1);
    if (
      relativeTemplatePath
        .split("/")
        .slice(0, -1)
        .some((segment) => segment.startsWith("_"))
    ) {
      return false;
    }
    return REACT_EMAIL_TEMPLATE_EXTENSION_PATTERN.test(relativeTemplatePath);
  });
};

export const collectConventionConsumedExportKeys = (graph: DependencyGraph): Set<string> => {
  const consumedExportKeys = new Set<string>();
  const packageMetadataByDirectory = new Map<string, ConventionPackageMetadata | undefined>();
  const themeConfigPathsByPackageDirectory = new Map<string, ReadonlySet<string>>();
  const dynamicBuildConsumedExportKeysByPackageDirectory = new Map<string, ReadonlySet<string>>();
  for (const module of graph.modules) {
    const canonicalModuleFilePath = toFilesystemIdentityPath(resolve(module.fileId.path));
    const packageDirectory = findNearestPackageDirectory(canonicalModuleFilePath);
    if (!packageDirectory) continue;
    if (!packageMetadataByDirectory.has(packageDirectory)) {
      packageMetadataByDirectory.set(packageDirectory, readPackageMetadata(packageDirectory));
    }
    const packageMetadata = packageMetadataByDirectory.get(packageDirectory);
    if (!packageMetadata) continue;

    const canonicalPackageDirectory = toFilesystemIdentityPath(packageDirectory);
    const packageRelativePath = toPosixPath(
      relative(canonicalPackageDirectory, canonicalModuleFilePath),
    );
    const isNextRouteSegmentModule =
      hasDependency(packageMetadata, "next") &&
      NEXT_ROUTE_SEGMENT_MODULE_PATTERN.test(packageRelativePath);
    const isContentCollectionsConfig =
      hasDependency(packageMetadata, "@content-collections/core") &&
      packageRelativePath === "content-collections.ts";
    const isReactEmailTemplate = isReactEmailDevTemplate(packageRelativePath, packageMetadata);
    const isCromwellPluginFrontendEntry =
      packageMetadata.isCromwellPlugin && packageRelativePath === "src/frontend/index.tsx";

    if (!dynamicBuildConsumedExportKeysByPackageDirectory.has(packageDirectory)) {
      dynamicBuildConsumedExportKeysByPackageDirectory.set(
        packageDirectory,
        collectDynamicBuildConsumedExportKeys(packageDirectory, packageMetadata.scripts),
      );
    }
    const dynamicBuildConsumedExportKeys =
      dynamicBuildConsumedExportKeysByPackageDirectory.get(packageDirectory);

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
        (isCromwellPluginFrontendEntry && exportInfo.name === "getStaticProps") ||
        dynamicBuildConsumedExportKeys?.has(
          buildExportKey(getFileIdentityKey(module.fileId.path), exportInfo.name),
        ) ||
        (exportInfo.isDefault &&
          (isContentCollectionsConfig || isReactEmailTemplate || isReferencedNextraThemeConfig))
      ) {
        consumedExportKeys.add(buildExportKey(module.fileId.path, exportInfo.name));
      }
    }
  }

  return consumedExportKeys;
};
