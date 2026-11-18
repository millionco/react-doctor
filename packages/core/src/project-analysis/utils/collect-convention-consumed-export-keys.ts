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
import { isPathInsideDirectoryOrEqual } from "./is-path-inside-directory-or-equal.js";
import { isRecord } from "../../utils/is-record.js";

interface ConventionPackageJson {
  cromwell?: { type?: string };
  name?: unknown;
  exports?: unknown;
  typesVersions?: unknown;
  files?: unknown;
  publishConfig?: unknown;
  private?: unknown;
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
  typesVersionExports: TypeVersionExports | undefined;
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

interface TypeVersionExports {
  declarationPaths: ReadonlySet<string>;
  packedPaths: ReadonlyArray<string>;
}

const resolveLiteralPackagePath = (path: string, directory: string): string | undefined => {
  const normalized = path.replace(/^\.\//, "").replace(/\/$/, "");
  if (
    !/^[\w@.-]+(?:\/[\w@.-]+)*$/.test(normalized) ||
    normalized.split("/").some((part) => part === "." || part === ".." || part === "node_modules")
  )
    return undefined;
  const resolved = resolve(directory, normalized);
  if (toFilesystemIdentityPath(resolved) !== resolved) return undefined;
  return resolved;
};

const collectTypeVersionExports = (
  packageJson: ConventionPackageJson,
  packageDirectory: string,
): TypeVersionExports | undefined => {
  const selector = packageJson.typesVersions;
  const publishConfig = packageJson.publishConfig;
  if (
    isRecord(publishConfig) &&
    ["directory", "exports", "files", "name", "typesVersions"].some((field) =>
      Object.hasOwn(publishConfig, field),
    )
  )
    return undefined;
  // Only the sole catch-all selector avoids version ordering. The explicit
  // literal files list establishes which package-relative paths are exposed.
  if (
    typeof packageJson.name !== "string" ||
    packageJson.name.length === 0 ||
    packageJson.private === true ||
    packageJson.exports !== undefined ||
    !isRecord(selector) ||
    Object.keys(selector).length !== 1 ||
    !isRecord(selector["*"]) ||
    !Array.isArray(packageJson.files) ||
    packageJson.files.length === 0
  )
    return undefined;

  const packedPaths: string[] = [];
  for (const item of packageJson.files) {
    if (typeof item !== "string") return undefined;
    const packedPath = resolveLiteralPackagePath(item, packageDirectory);
    if (!packedPath) return undefined;
    packedPaths.push(packedPath);
  }

  const declarationPaths = new Set<string>();
  for (const [subpath, targets] of Object.entries(selector["*"])) {
    if (
      !/^[\w@.-]+(?:\/[\w@.-]+)*$/.test(subpath) ||
      subpath.split("/").some((part) => part === "." || part === "..")
    )
      continue;
    if (!Array.isArray(targets) || targets.length !== 1) continue;
    const [target] = targets;
    if (typeof target !== "string" || !/\.d\.[cm]?ts$/.test(target)) continue;
    const path = resolveLiteralPackagePath(target, packageDirectory);
    if (path) declarationPaths.add(path);
  }
  return { declarationPaths, packedPaths };
};

const isExplicitlyPackedPath = (
  file: string,
  directory: string,
  packedPaths: ReadonlyArray<string>,
): boolean => {
  if (!packedPaths.some((path) => isPathInsideDirectoryOrEqual(file, path))) return false;
  // Nested ignore files can still prune descendants of an included directory.
  let current = dirname(file);
  while (current !== directory) {
    if (existsSync(resolve(current, ".npmignore")) || existsSync(resolve(current, ".gitignore"))) {
      return false;
    }
    current = dirname(current);
  }
  return true;
};

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
      typesVersionExports: collectTypeVersionExports(packageJson, packageDirectory),
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

interface TypeVersionDeclaration {
  packageDirectory: string;
  filePath: string;
  packedPaths: ReadonlyArray<string>;
}

const portableTypeModuleOptions: ts.CompilerOptions = {
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
};

const collectDeclaredTypeReExportKeys = (
  graph: DependencyGraph,
  declarations: ReadonlyMap<number, TypeVersionDeclaration>,
  consumedExportKeys: Set<string>,
): void => {
  if (declarations.size === 0) return;
  for (const edge of graph.edges) {
    if (!edge.isReExportEdge || !edge.isTypeOnly) continue;
    const declaration = declarations.get(edge.source);
    const wrapper = graph.modules[edge.source];
    const target = graph.modules[edge.target];
    if (
      !declaration ||
      !wrapper ||
      !target ||
      target.isAnalysisExcluded ||
      target.isGitIgnored ||
      target.parseErrors.length > 0
    )
      continue;
    const { packageDirectory, filePath, packedPaths } = declaration;
    const targetPath = resolve(target.fileId.path);
    if (
      toFilesystemIdentityPath(targetPath) !== targetPath ||
      findNearestPackageDirectory(targetPath) !== packageDirectory ||
      !isExplicitlyPackedPath(targetPath, packageDirectory, packedPaths)
    )
      continue;
    for (const { exportedName, originalName } of edge.reExportMappings) {
      if (originalName === "*" || originalName === "default") continue;
      const matchingWrapperExports = wrapper.exports.filter(
        (exportInfo) => exportInfo.name === exportedName,
      );
      if (matchingWrapperExports.length !== 1) continue;
      const [wrapperExport] = matchingWrapperExports;
      const specifier = wrapperExport.reExportSource;
      if (
        wrapperExport.isSynthetic ||
        !wrapperExport.isReExport ||
        !wrapperExport.isTypeOnly ||
        wrapperExport.reExportOriginalName !== originalName ||
        !specifier ||
        !/^\.\.?\//.test(specifier)
      )
        continue;
      const relativeResolution = resolve(dirname(filePath), specifier);
      if (!isPathInsideDirectoryOrEqual(relativeResolution, packageDirectory)) continue;
      const portableTarget = ts.resolveModuleName(
        specifier,
        filePath,
        portableTypeModuleOptions,
        ts.sys,
        undefined,
        undefined,
        ts.ModuleKind.ESNext,
      ).resolvedModule?.resolvedFileName;
      if (!portableTarget || resolve(portableTarget) !== targetPath) continue;
      const matchingExports = target.exports.filter(
        (exportInfo) => exportInfo.name === originalName,
      );
      if (
        matchingExports.length > 0 &&
        matchingExports.every((exportInfo) => exportInfo.isTypeOnly && !exportInfo.isReExport)
      ) {
        consumedExportKeys.add(buildExportKey(target.fileId.path, originalName));
      }
    }
  }
};

export const collectConventionConsumedExportKeys = (graph: DependencyGraph): Set<string> => {
  const consumedExportKeys = new Set<string>();
  const declarations = new Map<number, TypeVersionDeclaration>();
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
    const typeExports = packageMetadata.typesVersionExports;
    if (
      typeExports &&
      module.isDeclarationFile &&
      !module.isGitIgnored &&
      !module.isAnalysisExcluded &&
      module.parseErrors.length === 0 &&
      typeExports.declarationPaths.has(canonicalModuleFilePath) &&
      canonicalModuleFilePath === resolve(module.fileId.path) &&
      isExplicitlyPackedPath(canonicalModuleFilePath, packageDirectory, typeExports.packedPaths)
    ) {
      declarations.set(module.fileId.index, {
        packageDirectory,
        filePath: canonicalModuleFilePath,
        packedPaths: typeExports.packedPaths,
      });
    }

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

  collectDeclaredTypeReExportKeys(graph, declarations, consumedExportKeys);
  return consumedExportKeys;
};
