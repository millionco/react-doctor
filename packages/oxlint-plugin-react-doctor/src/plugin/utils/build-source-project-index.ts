import * as fs from "node:fs";
import * as path from "node:path";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { isEverySpecifierInlineType, isTypeOnlyImport } from "./is-type-only-import.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isTestlikeFilename } from "./is-testlike-filename.js";
import { normalizeFilename } from "./normalize-filename.js";
import { parseSourceFile, parseSourceText } from "./parse-source-file.js";
import { CROSS_FILE_PARSE_MAX_BYTES } from "../constants/thresholds.js";
import { resolveModulePath } from "./resolve-module-path.js";
import { walkAst } from "./walk-ast.js";

export interface SourceProjectModule {
  readonly filePath: string;
  readonly programNode: EsTreeNodeOfType<"Program">;
  readonly scopes: ScopeAnalysis;
  readonly sourceText?: string;
}

export interface SourceProjectBounds {
  readonly maximumFiles: number;
  readonly maximumEntries: number;
  readonly maximumDepth: number;
  readonly maximumBytes: number;
}

export interface SourceProjectIndex {
  readonly modulesByFilePath: ReadonlyMap<string, SourceProjectModule>;
  readonly htmlFilePaths: ReadonlyArray<string>;
  readonly consumerModulesByFilePath: ReadonlyMap<string, ReadonlySet<SourceProjectModule>>;
  readonly resolvedSourcePathByNode: WeakMap<EsTreeNode, string>;
  readonly unresolvedRuntimeSources: ReadonlySet<string>;
  readonly unresolvedRuntimeSourcesByFilePath: ReadonlyMap<string, ReadonlySet<string>>;
  readonly hasOpaqueMdxConsumerSurface: boolean;
}

export interface SourceProjectIndexInput {
  readonly rootDirectory: string;
  readonly currentFilePath: string;
  readonly currentProgramNode: EsTreeNodeOfType<"Program">;
  readonly currentScopes: ScopeAnalysis;
  readonly currentSourceText?: string;
  readonly requiredModuleSources?: ReadonlyArray<string>;
  readonly knownModuleSources?: ReadonlyArray<string>;
  readonly fresh?: boolean;
  readonly allowJsxInJs?: boolean;
  readonly includeNonProductionFiles?: boolean;
  readonly bounds?: SourceProjectBounds;
  readonly resolveSource?: (
    filePath: string,
    source: string,
    modulesByFilePath: ReadonlyMap<string, SourceProjectModule>,
  ) => string | null;
}

const SOURCE_PROJECT_FILE_PATTERN = /\.[cm]?[jt]sx?$/i;
const SOURCE_PROJECT_DECLARATION_FILE_PATTERN = /\.d\.[cm]?[jt]s$/i;
const SOURCE_PROJECT_MDX_FILE_PATTERN = /\.mdx$/i;
const SOURCE_PROJECT_HTML_FILE_PATTERN = /\.html?$/i;
const SOURCE_PROJECT_IGNORED_DIRECTORY_NAMES: ReadonlySet<string> = new Set([
  ".angular",
  ".astro",
  ".cache",
  ".contentlayer",
  ".docusaurus",
  ".expo",
  ".git",
  ".next",
  ".nuxt",
  ".output",
  ".svelte-kit",
  ".turbo",
  ".vercel",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "storybook-static",
]);
const sourceProjectScopeCache = new WeakMap<EsTreeNodeOfType<"Program">, ScopeAnalysis>();

const getSourceProjectModuleScopes = (programNode: EsTreeNodeOfType<"Program">): ScopeAnalysis => {
  const cachedScopes = sourceProjectScopeCache.get(programNode);
  if (cachedScopes) return cachedScopes;
  const scopes = analyzeScopes(programNode);
  sourceProjectScopeCache.set(programNode, scopes);
  return scopes;
};

const listProductionSourceFiles = (
  rootDirectory: string,
  bounds: SourceProjectBounds | undefined,
  includeNonProductionFiles: boolean,
): {
  sourceFilePaths: ReadonlyArray<string>;
  htmlFilePaths: ReadonlyArray<string>;
  hasOpaqueMdxConsumerSurface: boolean;
} | null => {
  const sourceFilePaths: string[] = [];
  const htmlFilePaths: string[] = [];
  const pendingDirectories = [{ directoryPath: rootDirectory, depth: 0 }];
  let hasOpaqueMdxConsumerSurface = false;
  let totalEntries = 0;
  let totalBytes = 0;

  while (pendingDirectories.length > 0) {
    const currentDirectory = pendingDirectories.pop();
    if (!currentDirectory) continue;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentDirectory.directoryPath, { withFileTypes: true });
    } catch {
      return null;
    }
    totalEntries += entries.length;
    if (bounds && totalEntries > bounds.maximumEntries) return null;
    for (const entry of entries) {
      const absolutePath = path.join(currentDirectory.directoryPath, entry.name);
      const isIgnoredDirectoryName =
        entry.name === "node_modules" ||
        entry.name === ".git" ||
        (!includeNonProductionFiles &&
          (SOURCE_PROJECT_IGNORED_DIRECTORY_NAMES.has(entry.name) ||
            (entry.name.startsWith(".") && entry.name !== ".dumi" && entry.name !== ".storybook")));
      if (entry.isSymbolicLink() && isIgnoredDirectoryName) continue;
      if (entry.isSymbolicLink()) return null;
      if (entry.isDirectory()) {
        if (isIgnoredDirectoryName) continue;
        if (bounds && currentDirectory.depth >= bounds.maximumDepth) return null;
        pendingDirectories.push({ directoryPath: absolutePath, depth: currentDirectory.depth + 1 });
        continue;
      }
      if (!entry.isFile() || (!includeNonProductionFiles && isTestlikeFilename(absolutePath)))
        continue;
      if (SOURCE_PROJECT_MDX_FILE_PATTERN.test(entry.name)) {
        hasOpaqueMdxConsumerSurface = true;
        continue;
      }
      if (SOURCE_PROJECT_HTML_FILE_PATTERN.test(entry.name)) {
        htmlFilePaths.push(normalizeFilename(absolutePath));
        continue;
      }
      if (!SOURCE_PROJECT_FILE_PATTERN.test(entry.name)) continue;
      if (SOURCE_PROJECT_DECLARATION_FILE_PATTERN.test(entry.name)) continue;
      if (bounds) {
        if (sourceFilePaths.length >= bounds.maximumFiles) return null;
        let fileSize: number;
        try {
          fileSize = fs.statSync(absolutePath).size;
        } catch {
          return null;
        }
        totalBytes += fileSize;
        if (fileSize > CROSS_FILE_PARSE_MAX_BYTES || totalBytes > bounds.maximumBytes) return null;
      }
      sourceFilePaths.push(normalizeFilename(absolutePath));
    }
  }

  return { sourceFilePaths, htmlFilePaths, hasOpaqueMdxConsumerSurface };
};

const sourceFilesMayImportRequiredModule = (
  sourceFilePaths: ReadonlyArray<string>,
  requiredModuleSources: ReadonlyArray<string>,
): boolean => {
  for (const sourceFilePath of sourceFilePaths) {
    let sourceText: string;
    try {
      sourceText = fs.readFileSync(sourceFilePath, "utf8");
    } catch {
      return true;
    }
    for (const moduleSource of requiredModuleSources) {
      if (sourceText.includes(`"${moduleSource}"`) || sourceText.includes(`'${moduleSource}'`)) {
        return true;
      }
    }
  }
  return false;
};

export const getRuntimeModuleSource = (node: EsTreeNode): string | null => {
  if (isNodeOfType(node, "ImportDeclaration")) {
    if (isTypeOnlyImport(node)) return null;
    return typeof node.source.value === "string" ? node.source.value : null;
  }
  if (isNodeOfType(node, "ExportNamedDeclaration")) {
    if (
      node.exportKind === "type" ||
      isEverySpecifierInlineType(node.specifiers, "ExportSpecifier", "exportKind")
    ) {
      return null;
    }
    return node.source && typeof node.source.value === "string" ? node.source.value : null;
  }
  if (isNodeOfType(node, "ExportAllDeclaration")) {
    if (node.exportKind === "type") return null;
    return typeof node.source.value === "string" ? node.source.value : null;
  }
  if (isNodeOfType(node, "ImportExpression")) {
    return isNodeOfType(node.source, "Literal") && typeof node.source.value === "string"
      ? node.source.value
      : null;
  }
  if (
    isNodeOfType(node, "CallExpression") &&
    isNodeOfType(node.callee, "Identifier") &&
    node.callee.name === "require" &&
    node.arguments.length === 1
  ) {
    const source = node.arguments[0];
    return source && isNodeOfType(source, "Literal") && typeof source.value === "string"
      ? source.value
      : null;
  }
  return null;
};

const indexModuleSources = (
  module: SourceProjectModule,
  consumerModulesByFilePath: Map<string, Set<SourceProjectModule>>,
  resolvedSourcePathByNode: WeakMap<EsTreeNode, string>,
  unresolvedRuntimeSources: Set<string>,
  unresolvedRuntimeSourcesByFilePath: Map<string, Set<string>>,
  modulesByFilePath: ReadonlyMap<string, SourceProjectModule>,
  resolveSource: SourceProjectIndexInput["resolveSource"],
): void => {
  walkAst(module.programNode, (node) => {
    const source = getRuntimeModuleSource(node);
    if (!source) return;
    const resolvedSourcePath = resolveSource
      ? resolveSource(module.filePath, source, modulesByFilePath)
      : resolveModulePath(module.filePath, source);
    if (!resolvedSourcePath) {
      unresolvedRuntimeSources.add(source);
      const unresolvedSources =
        unresolvedRuntimeSourcesByFilePath.get(module.filePath) ?? new Set();
      unresolvedSources.add(source);
      unresolvedRuntimeSourcesByFilePath.set(module.filePath, unresolvedSources);
      return;
    }
    const normalizedSourcePath = normalizeFilename(resolvedSourcePath);
    resolvedSourcePathByNode.set(node, normalizedSourcePath);
    const consumerModules = consumerModulesByFilePath.get(normalizedSourcePath) ?? new Set();
    consumerModules.add(module);
    consumerModulesByFilePath.set(normalizedSourcePath, consumerModules);
  });
};

export const buildSourceProjectIndex = ({
  rootDirectory,
  currentFilePath,
  currentProgramNode,
  currentScopes,
  currentSourceText,
  requiredModuleSources = [],
  knownModuleSources,
  fresh = false,
  allowJsxInJs = false,
  includeNonProductionFiles = false,
  bounds,
  resolveSource,
}: SourceProjectIndexInput): SourceProjectIndex | null => {
  if (
    currentSourceText !== undefined &&
    Buffer.byteLength(currentSourceText) > CROSS_FILE_PARSE_MAX_BYTES
  )
    return null;
  if (
    requiredModuleSources.length > 0 &&
    knownModuleSources !== undefined &&
    !requiredModuleSources.some((moduleSource) => knownModuleSources.includes(moduleSource))
  ) {
    return null;
  }
  const productionSourceFiles = listProductionSourceFiles(
    rootDirectory,
    bounds,
    includeNonProductionFiles,
  );
  if (!productionSourceFiles) return null;
  if (
    requiredModuleSources.length > 0 &&
    knownModuleSources === undefined &&
    !sourceFilesMayImportRequiredModule(
      productionSourceFiles.sourceFilePaths,
      requiredModuleSources,
    )
  ) {
    return null;
  }
  const modulesByFilePath = new Map<string, SourceProjectModule>();
  for (const filePath of productionSourceFiles.sourceFilePaths) {
    if (filePath === currentFilePath) {
      modulesByFilePath.set(filePath, {
        filePath,
        programNode: currentProgramNode,
        scopes: currentScopes,
        sourceText: currentSourceText,
      });
      continue;
    }
    let sourceText: string | undefined;
    if (fresh) {
      try {
        sourceText = fs.readFileSync(filePath, "utf8");
      } catch {
        return null;
      }
    }
    const parsedProgram =
      sourceText === undefined
        ? parseSourceFile(filePath)
        : parseSourceText({
            filename: filePath,
            sourceText,
            language:
              allowJsxInJs && path.extname(filePath).toLowerCase() === ".js" ? "jsx" : undefined,
          });
    if (!parsedProgram || !isNodeOfType(parsedProgram, "Program")) return null;
    modulesByFilePath.set(filePath, {
      filePath,
      programNode: parsedProgram,
      scopes: fresh ? analyzeScopes(parsedProgram) : getSourceProjectModuleScopes(parsedProgram),
      sourceText,
    });
  }

  const consumerModulesByFilePath = new Map<string, Set<SourceProjectModule>>();
  const resolvedSourcePathByNode = new WeakMap<EsTreeNode, string>();
  const unresolvedRuntimeSources = new Set<string>();
  const unresolvedRuntimeSourcesByFilePath = new Map<string, Set<string>>();
  for (const module of modulesByFilePath.values()) {
    indexModuleSources(
      module,
      consumerModulesByFilePath,
      resolvedSourcePathByNode,
      unresolvedRuntimeSources,
      unresolvedRuntimeSourcesByFilePath,
      modulesByFilePath,
      resolveSource,
    );
  }

  return {
    modulesByFilePath,
    htmlFilePaths: productionSourceFiles.htmlFilePaths,
    consumerModulesByFilePath,
    resolvedSourcePathByNode,
    unresolvedRuntimeSources,
    unresolvedRuntimeSourcesByFilePath,
    hasOpaqueMdxConsumerSurface: productionSourceFiles.hasOpaqueMdxConsumerSurface,
  };
};
