import * as fs from "node:fs";
import * as path from "node:path";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import {
  CLOSED_JSON_SNAPSHOT_PROJECT_MAX_BYTES,
  CLOSED_JSON_SNAPSHOT_PROJECT_MAX_DEPTH,
  CLOSED_JSON_SNAPSHOT_PROJECT_MAX_ENTRIES,
  CLOSED_JSON_SNAPSHOT_PROJECT_MAX_FILES,
  CLOSED_JSON_SNAPSHOT_RESOURCE_IMPORT_PATTERN,
} from "./closed-json-snapshot/constants.js";
import { buildSourceProjectIndex } from "./build-source-project-index.js";
import type { SourceProjectIndex, SourceProjectModule } from "./build-source-project-index.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { parseSourceText } from "./parse-source-file.js";
import type { ClosedJsonSnapshotSourceResolutionPolicy } from "./closed-json-snapshot-config/interfaces.js";
import { resolveClosedJsonSnapshotWebpackSource } from "./closed-json-snapshot-config/resolve-closed-json-snapshot-webpack-source.js";

export interface ClosedJsonSnapshotModule {
  readonly filePath: string;
  readonly sourceText: string;
  readonly program: EsTreeNode;
  readonly scopes: ScopeAnalysis;
}

export interface ClosedJsonSnapshotProject {
  readonly rootDirectory: string;
  readonly modules: ReadonlyMap<string, ClosedJsonSnapshotModule>;
  readonly knownPublicEntryTargets: ReadonlyArray<string>;
  readonly index: SourceProjectIndex;
  readonly sourceResolutionPolicy: ClosedJsonSnapshotSourceResolutionPolicy;
  readonly resolveImport: (fromFilePath: string, source: string) => ClosedJsonSnapshotModule | null;
}

export interface ClosedJsonSnapshotProjectInput {
  readonly knownPublicEntryTargets?: ReadonlyArray<string>;
  readonly rootDirectory: string;
  readonly allowJsxInJs: boolean;
  readonly currentFilePath?: string;
  readonly currentProgramNode?: EsTreeNode;
  readonly currentScopes?: ScopeAnalysis;
  readonly currentSourceText?: string;
  readonly sourceResolutionPolicy: ClosedJsonSnapshotSourceResolutionPolicy;
}

export const getClosedJsonSnapshotProject = ({
  rootDirectory,
  allowJsxInJs,
  currentFilePath,
  currentProgramNode,
  currentScopes,
  currentSourceText,
  sourceResolutionPolicy,
  knownPublicEntryTargets = [],
}: ClosedJsonSnapshotProjectInput): ClosedJsonSnapshotProject | null => {
  const absoluteRootDirectory = path.resolve(rootDirectory);
  if (path.resolve(sourceResolutionPolicy.rootDirectory) !== absoluteRootDirectory) return null;
  const programNode =
    currentProgramNode ??
    parseSourceText({
      filename: path.join(absoluteRootDirectory, "snapshot-entry.js"),
      sourceText: "",
    });
  if (!programNode || !isNodeOfType(programNode, "Program")) return null;
  if (currentScopes && currentScopes.rootScope.node !== programNode) return null;
  let index: SourceProjectIndex | null;
  const resolveSource = (
    fromFilePath: string,
    source: string,
    moduleMap: ReadonlyMap<string, SourceProjectModule>,
  ): string | null =>
    resolveClosedJsonSnapshotWebpackSource({
      fromFilePath,
      source,
      modules: moduleMap,
      resolutionPolicy: sourceResolutionPolicy,
    });
  try {
    index = buildSourceProjectIndex({
      rootDirectory: absoluteRootDirectory,
      currentFilePath: currentFilePath ? path.resolve(currentFilePath) : "",
      currentProgramNode: programNode,
      currentScopes: currentScopes ?? analyzeScopes(programNode),
      currentSourceText,
      fresh: true,
      allowJsxInJs,
      includeNonProductionFiles: true,
      bounds: {
        maximumFiles: CLOSED_JSON_SNAPSHOT_PROJECT_MAX_FILES,
        maximumEntries: CLOSED_JSON_SNAPSHOT_PROJECT_MAX_ENTRIES,
        maximumDepth: CLOSED_JSON_SNAPSHOT_PROJECT_MAX_DEPTH,
        maximumBytes: CLOSED_JSON_SNAPSHOT_PROJECT_MAX_BYTES,
      },
      resolveSource,
    });
  } catch {
    return null;
  }
  if (!index || index.hasOpaqueMdxConsumerSurface) return null;
  const excludedConfigPaths = new Set(sourceResolutionPolicy.configFilePaths ?? []);
  if (currentFilePath && excludedConfigPaths.has(path.resolve(currentFilePath))) return null;
  const unresolvedRuntimeSourcesByFilePath = new Map(
    [...index.unresolvedRuntimeSourcesByFilePath].filter(
      ([filename]) => !excludedConfigPaths.has(filename),
    ),
  );
  const unresolvedRuntimeSources = new Set(
    [...unresolvedRuntimeSourcesByFilePath.values()].flatMap((sources) => [...sources]),
  );
  for (const source of unresolvedRuntimeSources) {
    if (/[!?\\]/.test(source)) return null;
    if (CLOSED_JSON_SNAPSHOT_RESOURCE_IMPORT_PATTERN.test(source)) continue;
    if (
      source.startsWith(".") ||
      source.startsWith("/") ||
      sourceResolutionPolicy.aliases.some(
        (alias) => source === alias.name || (!alias.exact && source.startsWith(`${alias.name}/`)),
      )
    )
      return null;
  }
  for (const filename of excludedConfigPaths) {
    if (
      [...(index.consumerModulesByFilePath.get(filename) ?? [])].some(
        (module) => !excludedConfigPaths.has(module.filePath),
      )
    )
      return null;
  }
  index = {
    ...index,
    modulesByFilePath: new Map(
      [...index.modulesByFilePath].filter(([filename]) => !excludedConfigPaths.has(filename)),
    ),
    consumerModulesByFilePath: new Map(
      [...index.consumerModulesByFilePath]
        .filter(([filename]) => !excludedConfigPaths.has(filename))
        .map(([filename, consumers]) => [
          filename,
          new Set([...consumers].filter((module) => !excludedConfigPaths.has(module.filePath))),
        ]),
    ),
    htmlFilePaths: [],
    unresolvedRuntimeSources,
    unresolvedRuntimeSourcesByFilePath,
  };
  const modules = new Map<string, ClosedJsonSnapshotModule>();
  try {
    for (const module of index.modulesByFilePath.values()) {
      modules.set(module.filePath, {
        filePath: module.filePath,
        sourceText: module.sourceText ?? fs.readFileSync(module.filePath, "utf8"),
        program: module.programNode,
        scopes: module.scopes,
      });
    }
  } catch {
    return null;
  }
  const resolveImport = (fromFilePath: string, source: string): ClosedJsonSnapshotModule | null => {
    const resolvedPath = resolveSource(fromFilePath, source, index.modulesByFilePath);
    return resolvedPath ? (modules.get(resolvedPath) ?? null) : null;
  };
  return {
    rootDirectory: absoluteRootDirectory,
    modules,
    index,
    resolveImport,
    sourceResolutionPolicy,
    knownPublicEntryTargets,
  };
};
