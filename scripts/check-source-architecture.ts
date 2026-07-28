import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { parseSync } from "oxc-parser";
import { findStronglyConnectedComponents } from "../packages/deslop-js/src/utils/find-strongly-connected-components.js";

interface SourceDependency {
  sourcePath: string;
  targetPath: string;
  specifier: string;
  line: number;
  isTypeOnly: boolean;
  isDynamic: boolean;
}

interface SourceParseFailure {
  filePath: string;
  message: string;
}

export interface ForbiddenDependencyRule {
  name: string;
  sourcePathPatterns: ReadonlyArray<RegExp>;
  forbiddenTargetPathPatterns: ReadonlyArray<RegExp>;
  reason: string;
}

export interface ForbiddenSourceDependency extends SourceDependency {
  ruleName: string;
  reason: string;
}

export interface SourceArchitectureOptions {
  rootDirectory: string;
  sourceDirectories?: ReadonlyArray<string>;
  forbiddenDependencyRules?: ReadonlyArray<ForbiddenDependencyRule>;
}

export interface SourceArchitectureResult {
  sourceFileCount: number;
  runtimeImportComponents: ReadonlyArray<ReadonlyArray<string>>;
  dependencies: ReadonlyArray<SourceDependency>;
  forbiddenDependencies: ReadonlyArray<ForbiddenSourceDependency>;
  parseFailures: ReadonlyArray<SourceParseFailure>;
}

interface ParsedDependency {
  specifier: string;
  line: number;
  isTypeOnly: boolean;
  isDynamic: boolean;
}

interface WorkspaceSourcePackage {
  readonly name: string;
  readonly sourcePathBySubpath: ReadonlyMap<string, string>;
}

const SOURCE_FILE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
const TEST_FILE_MARKERS = [".spec.", ".stories.", ".test."];
const TEST_DIRECTORY_NAMES = new Set([
  "__fixtures__",
  "__tests__",
  "fixtures",
  "test",
  "tests",
  "test-utils",
]);
const JAVASCRIPT_SOURCE_ALTERNATIVES: Readonly<Record<string, ReadonlyArray<string>>> = {
  ".js": [".ts", ".tsx", ".js", ".jsx"],
  ".jsx": [".tsx", ".jsx"],
  ".mjs": [".mts", ".mjs"],
  ".cjs": [".cts", ".cjs"],
};
const EXPORT_CONDITION_PRIORITY = ["default", "import", "require", "types"];

const RUNTIME_LAYER_PATH_PATTERNS = [
  /\/src\/cli\//,
  /\/src\/services\//,
  /\/src\/runners\//,
  /\/src\/(?:diagnose|editor-scan|inspect|instrument|lsp-telemetry|observability|run-inspect|run-oxlint)\.[cm]?[jt]sx?$/,
];

export const DEFAULT_FORBIDDEN_DEPENDENCY_RULES: ReadonlyArray<ForbiddenDependencyRule> = [
  {
    name: "neutral-foundations",
    sourcePathPatterns: [
      /\/src\/types\//,
      /\/src\/contracts(?:\/|\.[cm]?[jt]sx?$)/,
      /\/src\/schemas\.[cm]?[jt]sx?$/,
      /\/src\/errors\.[cm]?[jt]sx?$/,
    ],
    forbiddenTargetPathPatterns: RUNTIME_LAYER_PATH_PATTERNS,
    reason:
      "Foundation types, schemas, and errors must remain independent of CLI, telemetry, services, runners, and orchestrators.",
  },
  {
    name: "project-discovery",
    sourcePathPatterns: [/\/src\/project-info\//],
    forbiddenTargetPathPatterns: RUNTIME_LAYER_PATH_PATTERNS,
    reason: "Project discovery must remain below runtime services and orchestration.",
  },
  {
    name: "leaf-utilities",
    sourcePathPatterns: [/\/src\/utils\//],
    forbiddenTargetPathPatterns: RUNTIME_LAYER_PATH_PATTERNS,
    reason: "Leaf utilities must not depend on runtime services, CLI, telemetry, or orchestration.",
  },
];

const toPosixPath = (filePath: string): string => filePath.split(path.sep).join("/");

const compareText = (leftText: string, rightText: string): number => {
  if (leftText < rightText) return -1;
  if (leftText > rightText) return 1;
  return 0;
};

const isProductionSourceFile = (filePath: string, sourceDirectory: string): boolean => {
  const extension = path.extname(filePath);
  if (!SOURCE_FILE_EXTENSIONS.includes(extension)) return false;
  if (filePath.endsWith(".d.ts")) return false;

  const relativePath = path.relative(sourceDirectory, filePath);
  const pathSegments = relativePath.split(path.sep);
  if (pathSegments.some((pathSegment) => TEST_DIRECTORY_NAMES.has(pathSegment))) return false;

  const fileName = path.basename(filePath);
  return !TEST_FILE_MARKERS.some((testMarker) => fileName.includes(testMarker));
};

const listProductionSourceFiles = (sourceDirectory: string): string[] => {
  if (!fs.existsSync(sourceDirectory)) return [];

  const sourceFiles: string[] = [];
  const pendingDirectories = [sourceDirectory];
  while (pendingDirectories.length > 0) {
    const currentDirectory = pendingDirectories.pop();
    if (currentDirectory === undefined) break;

    const directoryEntries = fs
      .readdirSync(currentDirectory, { withFileTypes: true })
      .sort((leftEntry, rightEntry) => compareText(leftEntry.name, rightEntry.name));
    for (const directoryEntry of directoryEntries) {
      const entryPath = path.join(currentDirectory, directoryEntry.name);
      if (directoryEntry.isDirectory()) {
        if (!TEST_DIRECTORY_NAMES.has(directoryEntry.name)) pendingDirectories.push(entryPath);
      } else if (directoryEntry.isFile() && isProductionSourceFile(entryPath, sourceDirectory)) {
        sourceFiles.push(path.resolve(entryPath));
      }
    }
  }

  return sourceFiles.sort();
};

const discoverPackageSourceDirectories = (rootDirectory: string): string[] => {
  const packagesDirectory = path.join(rootDirectory, "packages");
  if (!fs.existsSync(packagesDirectory)) return [];

  return fs
    .readdirSync(packagesDirectory, { withFileTypes: true })
    .filter((directoryEntry) => directoryEntry.isDirectory())
    .map((directoryEntry) => path.join(packagesDirectory, directoryEntry.name, "src"))
    .filter((sourceDirectory) => fs.existsSync(sourceDirectory))
    .sort();
};

const getLineNumber = (sourceText: string, offset: number): number =>
  sourceText.slice(0, offset).split("\n").length;

const collectDynamicImportDependencies = (
  sourceText: string,
  program: unknown,
): ParsedDependency[] => {
  const dependencies: ParsedDependency[] = [];
  const visitedNodes = new WeakSet<object>();
  const visitNode = (node: unknown): void => {
    if (!node || typeof node !== "object" || visitedNodes.has(node)) return;
    visitedNodes.add(node);

    if (Reflect.get(node, "type") === "ImportExpression") {
      const sourceNode = Reflect.get(node, "source");
      if (
        sourceNode &&
        typeof sourceNode === "object" &&
        Reflect.get(sourceNode, "type") === "Literal"
      ) {
        const specifier = Reflect.get(sourceNode, "value");
        const startOffset = Reflect.get(node, "start");
        if (typeof specifier === "string" && typeof startOffset === "number") {
          dependencies.push({
            specifier,
            line: getLineNumber(sourceText, startOffset),
            isTypeOnly: false,
            isDynamic: true,
          });
        }
      }
    }

    for (const childNode of Object.values(node)) {
      if (Array.isArray(childNode)) {
        for (const arrayChildNode of childNode) visitNode(arrayChildNode);
      } else {
        visitNode(childNode);
      }
    }
  };

  visitNode(program);
  return dependencies;
};

const parseDependencies = (
  filePath: string,
): { dependencies: ParsedDependency[]; parseFailures: SourceParseFailure[] } => {
  const sourceText = fs.readFileSync(filePath, "utf8");
  try {
    const parseResult = parseSync(filePath, sourceText, { astType: "ts" });
    const parseFailures = parseResult.errors
      .filter((parseError) => parseError.severity === "Error")
      .map((parseError) => ({
        filePath,
        message: parseError.message,
      }));
    const dependencies: ParsedDependency[] = parseResult.module.staticImports.map(
      (staticImport) => ({
        specifier: staticImport.moduleRequest.value,
        line: getLineNumber(sourceText, staticImport.start),
        isTypeOnly:
          staticImport.entries.length > 0 &&
          staticImport.entries.every((importEntry) => importEntry.isType),
        isDynamic: false,
      }),
    );

    const reExportDependencies = new Map<string, ParsedDependency>();
    for (const staticExport of parseResult.module.staticExports) {
      for (const exportEntry of staticExport.entries) {
        const specifier = exportEntry.moduleRequest?.value;
        if (specifier === undefined) continue;

        const existingDependency = reExportDependencies.get(specifier);
        if (existingDependency === undefined) {
          reExportDependencies.set(specifier, {
            specifier,
            line: getLineNumber(sourceText, exportEntry.start),
            isTypeOnly: exportEntry.isType,
            isDynamic: false,
          });
        } else if (!exportEntry.isType) {
          existingDependency.isTypeOnly = false;
        }
      }
    }

    dependencies.push(
      ...reExportDependencies.values(),
      ...collectDynamicImportDependencies(sourceText, parseResult.program),
    );
    return { dependencies, parseFailures };
  } catch (parseError) {
    return {
      dependencies: [],
      parseFailures: [
        {
          filePath,
          message: parseError instanceof Error ? parseError.message : String(parseError),
        },
      ],
    };
  }
};

const resolveSourcePath = (
  unresolvedPath: string,
  sourceFilePaths: ReadonlySet<string>,
): string | undefined => {
  const importedExtension = path.extname(unresolvedPath);
  const candidatePaths: string[] = [];
  if (importedExtension === "") {
    for (const sourceExtension of SOURCE_FILE_EXTENSIONS) {
      candidatePaths.push(`${unresolvedPath}${sourceExtension}`);
    }
    for (const sourceExtension of SOURCE_FILE_EXTENSIONS) {
      candidatePaths.push(path.join(unresolvedPath, `index${sourceExtension}`));
    }
  } else {
    const sourceAlternatives = JAVASCRIPT_SOURCE_ALTERNATIVES[importedExtension];
    if (sourceAlternatives !== undefined) {
      const pathWithoutExtension = unresolvedPath.slice(0, -importedExtension.length);
      for (const sourceExtension of sourceAlternatives) {
        candidatePaths.push(`${pathWithoutExtension}${sourceExtension}`);
      }
    } else {
      candidatePaths.push(unresolvedPath);
    }
  }

  return candidatePaths.find((candidatePath) => sourceFilePaths.has(candidatePath));
};

const resolveRelativeSourcePath = (
  sourceFilePath: string,
  specifier: string,
  sourceFilePaths: ReadonlySet<string>,
): string | undefined => {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) return undefined;
  if (specifier.includes("*")) return undefined;

  const pathSpecifier = specifier.split(/[?#]/, 1)[0];
  return resolveSourcePath(
    path.resolve(path.dirname(sourceFilePath), pathSpecifier),
    sourceFilePaths,
  );
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const resolveExportTarget = (exportValue: unknown): string | undefined => {
  if (typeof exportValue === "string") return exportValue;
  if (!isRecord(exportValue)) return undefined;

  for (const condition of EXPORT_CONDITION_PRIORITY) {
    const conditionTarget = resolveExportTarget(exportValue[condition]);
    if (conditionTarget !== undefined) return conditionTarget;
  }
  return undefined;
};

const resolvePackageTargetSourcePath = (
  packageDirectory: string,
  sourceDirectory: string,
  target: string,
  sourceFilePaths: ReadonlySet<string>,
): string | undefined => {
  if (target.startsWith("./src/")) {
    return resolveSourcePath(path.resolve(packageDirectory, target), sourceFilePaths);
  }
  if (!target.startsWith("./dist/")) return undefined;

  const sourceSubpath = target
    .slice("./dist/".length)
    .replace(/\.d\.[cm]?ts$/, "")
    .replace(/\.[cm]?[jt]sx?$/, "");
  return resolveSourcePath(path.join(sourceDirectory, sourceSubpath), sourceFilePaths);
};

const discoverWorkspaceSourcePackages = (
  sourceDirectories: ReadonlyArray<string>,
  sourceFilePaths: ReadonlySet<string>,
): ReadonlyArray<WorkspaceSourcePackage> =>
  sourceDirectories
    .flatMap((sourceDirectory) => {
      const packageDirectory = path.dirname(sourceDirectory);
      const packageManifestPath = path.join(packageDirectory, "package.json");
      if (!fs.existsSync(packageManifestPath)) return [];

      const manifest = JSON.parse(fs.readFileSync(packageManifestPath, "utf8"));
      if (typeof manifest.name !== "string" || manifest.name.length === 0) return [];

      const sourcePathBySubpath = new Map<string, string>();
      const exportEntries = isRecord(manifest.exports)
        ? Object.entries(manifest.exports).filter(
            ([exportKey]) => exportKey === "." || exportKey.startsWith("./"),
          )
        : [];
      if (exportEntries.length > 0) {
        for (const [exportKey, exportValue] of exportEntries) {
          const target = resolveExportTarget(exportValue);
          if (target === undefined) continue;
          const sourcePath = resolvePackageTargetSourcePath(
            packageDirectory,
            sourceDirectory,
            target,
            sourceFilePaths,
          );
          if (sourcePath !== undefined) {
            sourcePathBySubpath.set(exportKey === "." ? "" : exportKey.slice(2), sourcePath);
          }
        }
      } else {
        const rootTarget = resolveExportTarget(manifest.exports);
        if (rootTarget !== undefined) {
          const sourcePath = resolvePackageTargetSourcePath(
            packageDirectory,
            sourceDirectory,
            rootTarget,
            sourceFilePaths,
          );
          if (sourcePath !== undefined) sourcePathBySubpath.set("", sourcePath);
        }
      }

      const fallbackRootSourcePath = resolveSourcePath(
        path.join(sourceDirectory, "index"),
        sourceFilePaths,
      );
      if (fallbackRootSourcePath !== undefined && !sourcePathBySubpath.has("")) {
        sourcePathBySubpath.set("", fallbackRootSourcePath);
      }
      return [{ name: manifest.name, sourcePathBySubpath }];
    })
    .sort((leftPackage, rightPackage) => compareText(leftPackage.name, rightPackage.name));

const resolveWorkspaceSourcePath = (
  specifier: string,
  workspacePackages: ReadonlyArray<WorkspaceSourcePackage>,
  sourceFilePaths: ReadonlySet<string>,
): string | undefined => {
  const workspacePackage = workspacePackages.find(
    (candidatePackage) =>
      specifier === candidatePackage.name || specifier.startsWith(`${candidatePackage.name}/`),
  );
  if (workspacePackage === undefined) return undefined;

  const packageSubpath =
    specifier === workspacePackage.name ? "" : specifier.slice(workspacePackage.name.length + 1);
  const exportedSourcePath = workspacePackage.sourcePathBySubpath.get(packageSubpath);
  if (exportedSourcePath !== undefined) return exportedSourcePath;

  const packageRootSourcePath = workspacePackage.sourcePathBySubpath.get("");
  if (packageRootSourcePath === undefined || packageSubpath.length === 0) return undefined;
  return resolveSourcePath(
    path.join(path.dirname(packageRootSourcePath), packageSubpath),
    sourceFilePaths,
  );
};

const matchesAnyPattern = (filePath: string, patterns: ReadonlyArray<RegExp>): boolean =>
  patterns.some((pattern) => pattern.test(toPosixPath(filePath)));

const findForbiddenDependencies = (
  dependencies: ReadonlyArray<SourceDependency>,
  rules: ReadonlyArray<ForbiddenDependencyRule>,
): ForbiddenSourceDependency[] => {
  const forbiddenDependencies = new Map<string, ForbiddenSourceDependency>();
  for (const dependency of dependencies) {
    for (const rule of rules) {
      if (!matchesAnyPattern(dependency.sourcePath, rule.sourcePathPatterns)) continue;
      if (!matchesAnyPattern(dependency.targetPath, rule.forbiddenTargetPathPatterns)) continue;

      const dependencyKey = `${rule.name}\0${dependency.sourcePath}\0${dependency.targetPath}`;
      const existingDependency = forbiddenDependencies.get(dependencyKey);
      if (existingDependency === undefined || dependency.line < existingDependency.line) {
        forbiddenDependencies.set(dependencyKey, {
          ...dependency,
          ruleName: rule.name,
          reason: rule.reason,
        });
      }
    }
  }

  return [...forbiddenDependencies.values()].sort(
    (leftDependency, rightDependency) =>
      compareText(leftDependency.sourcePath, rightDependency.sourcePath) ||
      compareText(leftDependency.targetPath, rightDependency.targetPath) ||
      compareText(leftDependency.ruleName, rightDependency.ruleName),
  );
};

const findRuntimeImportComponents = (
  sourceFilePaths: ReadonlyArray<string>,
  dependencies: ReadonlyArray<SourceDependency>,
): string[][] => {
  const sourceFileIndexByPath = new Map(
    sourceFilePaths.map((sourceFilePath, sourceFileIndex) => [sourceFilePath, sourceFileIndex]),
  );
  const runtimeTargetSets = sourceFilePaths.map(() => new Set<number>());
  for (const dependency of dependencies) {
    if (dependency.isTypeOnly || dependency.isDynamic) continue;
    const sourceFileIndex = sourceFileIndexByPath.get(dependency.sourcePath);
    const targetFileIndex = sourceFileIndexByPath.get(dependency.targetPath);
    if (sourceFileIndex === undefined || targetFileIndex === undefined) continue;
    runtimeTargetSets[sourceFileIndex].add(targetFileIndex);
  }

  const adjacencyList = runtimeTargetSets.map((targetSet) =>
    [...targetSet].sort((leftIndex, rightIndex) => leftIndex - rightIndex),
  );
  return findStronglyConnectedComponents(adjacencyList)
    .filter(
      (component) =>
        component.length > 1 ||
        (component.length === 1 && adjacencyList[component[0]].includes(component[0])),
    )
    .map((component) => component.map((sourceFileIndex) => sourceFilePaths[sourceFileIndex]).sort())
    .sort((leftComponent, rightComponent) => compareText(leftComponent[0], rightComponent[0]));
};

export const analyzeSourceArchitecture = (
  options: SourceArchitectureOptions,
): SourceArchitectureResult => {
  const rootDirectory = path.resolve(options.rootDirectory);
  const sourceDirectories = (
    options.sourceDirectories?.map((sourceDirectory) =>
      path.resolve(rootDirectory, sourceDirectory),
    ) ?? discoverPackageSourceDirectories(rootDirectory)
  ).sort();
  const sourceFilePaths = [...new Set(sourceDirectories.flatMap(listProductionSourceFiles))].sort();
  const sourceFilePathSet = new Set(sourceFilePaths);
  const workspacePackages = discoverWorkspaceSourcePackages(sourceDirectories, sourceFilePathSet);
  const dependencies: SourceDependency[] = [];
  const parseFailures: SourceParseFailure[] = [];

  for (const sourceFilePath of sourceFilePaths) {
    const parsedSource = parseDependencies(sourceFilePath);
    parseFailures.push(...parsedSource.parseFailures);
    for (const parsedDependency of parsedSource.dependencies) {
      const targetFilePath =
        resolveRelativeSourcePath(sourceFilePath, parsedDependency.specifier, sourceFilePathSet) ??
        resolveWorkspaceSourcePath(
          parsedDependency.specifier,
          workspacePackages,
          sourceFilePathSet,
        );
      if (targetFilePath === undefined) continue;
      dependencies.push({
        sourcePath: sourceFilePath,
        targetPath: targetFilePath,
        specifier: parsedDependency.specifier,
        line: parsedDependency.line,
        isTypeOnly: parsedDependency.isTypeOnly,
        isDynamic: parsedDependency.isDynamic,
      });
    }
  }

  dependencies.sort(
    (leftDependency, rightDependency) =>
      compareText(leftDependency.sourcePath, rightDependency.sourcePath) ||
      leftDependency.line - rightDependency.line ||
      compareText(leftDependency.targetPath, rightDependency.targetPath),
  );

  return {
    sourceFileCount: sourceFilePaths.length,
    runtimeImportComponents: findRuntimeImportComponents(sourceFilePaths, dependencies),
    dependencies,
    forbiddenDependencies: findForbiddenDependencies(
      dependencies,
      options.forbiddenDependencyRules ?? DEFAULT_FORBIDDEN_DEPENDENCY_RULES,
    ),
    parseFailures: parseFailures.sort((leftFailure, rightFailure) =>
      compareText(leftFailure.filePath, rightFailure.filePath),
    ),
  };
};

const formatRepositoryPath = (rootDirectory: string, filePath: string): string =>
  toPosixPath(path.relative(rootDirectory, filePath));

export const formatSourceArchitectureFailures = (
  rootDirectory: string,
  result: SourceArchitectureResult,
): string => {
  const failureGroups: string[] = [];

  for (const component of result.runtimeImportComponents) {
    const componentPathSet = new Set(component);
    const componentEdges = result.dependencies.filter(
      (dependency) =>
        !dependency.isTypeOnly &&
        !dependency.isDynamic &&
        componentPathSet.has(dependency.sourcePath) &&
        componentPathSet.has(dependency.targetPath),
    );
    failureGroups.push(
      [
        `Runtime import SCC (${component.length} files):`,
        ...component.map((filePath) => `  - ${formatRepositoryPath(rootDirectory, filePath)}`),
        "  Internal edges:",
        ...componentEdges.map(
          (dependency) =>
            `  - ${formatRepositoryPath(rootDirectory, dependency.sourcePath)}:${dependency.line} -> ${formatRepositoryPath(rootDirectory, dependency.targetPath)}`,
        ),
        "  Break at least one runtime edge or move the shared dependency below the component.",
      ].join("\n"),
    );
  }

  for (const dependency of result.forbiddenDependencies) {
    failureGroups.push(
      [
        `Forbidden backward edge (${dependency.ruleName}):`,
        `  ${formatRepositoryPath(rootDirectory, dependency.sourcePath)}:${dependency.line} -> ${formatRepositoryPath(rootDirectory, dependency.targetPath)}`,
        `  ${dependency.reason}`,
      ].join("\n"),
    );
  }

  for (const parseFailure of result.parseFailures) {
    failureGroups.push(
      [
        "Unable to verify source architecture:",
        `  ${formatRepositoryPath(rootDirectory, parseFailure.filePath)}`,
        `  ${parseFailure.message}`,
      ].join("\n"),
    );
  }

  return failureGroups.join("\n\n");
};

const SCRIPT_FILE_PATH = fileURLToPath(import.meta.url);
const runSourceArchitectureCheck = (): void => {
  const rootDirectory = path.resolve(path.dirname(SCRIPT_FILE_PATH), "..");
  const result = analyzeSourceArchitecture({ rootDirectory });
  const failureCount =
    result.runtimeImportComponents.length +
    result.forbiddenDependencies.length +
    result.parseFailures.length;
  process.stdout.write(
    `Source architecture: ${result.sourceFileCount} files, ${failureCount} violations.\n`,
  );
  if (failureCount === 0) return;

  process.stderr.write(`${formatSourceArchitectureFailures(rootDirectory, result)}\n`);
  process.exitCode = 1;
};

if (path.resolve(process.argv[1] ?? "") === SCRIPT_FILE_PATH) runSourceArchitectureCheck();
