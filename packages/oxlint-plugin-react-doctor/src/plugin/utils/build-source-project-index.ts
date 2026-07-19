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
import { parseSourceFile } from "./parse-source-file.js";
import { resolveModulePath } from "./resolve-module-path.js";
import { walkAst } from "./walk-ast.js";

export interface SourceProjectModule {
  readonly filePath: string;
  readonly programNode: EsTreeNodeOfType<"Program">;
  readonly scopes: ScopeAnalysis;
}

export interface SourceProjectIndex {
  readonly modulesByFilePath: ReadonlyMap<string, SourceProjectModule>;
  readonly consumerModulesByFilePath: ReadonlyMap<string, ReadonlySet<SourceProjectModule>>;
  readonly resolvedSourcePathByNode: WeakMap<EsTreeNode, string>;
  readonly unresolvedRuntimeSources: ReadonlySet<string>;
  readonly hasOpaqueMdxConsumerSurface: boolean;
}

const SOURCE_PROJECT_FILE_PATTERN = /\.[cm]?[jt]sx?$/i;
const SOURCE_PROJECT_DECLARATION_FILE_PATTERN = /\.d\.[cm]?[jt]s$/i;
const SOURCE_PROJECT_MDX_FILE_PATTERN = /\.mdx$/i;
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
): { sourceFilePaths: ReadonlyArray<string>; hasOpaqueMdxConsumerSurface: boolean } | null => {
  const sourceFilePaths: string[] = [];
  const pendingDirectories = [rootDirectory];
  let hasOpaqueMdxConsumerSurface = false;

  while (pendingDirectories.length > 0) {
    const currentDirectory = pendingDirectories.pop();
    if (!currentDirectory) continue;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentDirectory, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const entry of entries) {
      const absolutePath = path.join(currentDirectory, entry.name);
      const isIgnoredDirectoryName =
        SOURCE_PROJECT_IGNORED_DIRECTORY_NAMES.has(entry.name) ||
        (entry.name.startsWith(".") && entry.name !== ".dumi" && entry.name !== ".storybook");
      if (entry.isSymbolicLink() && isIgnoredDirectoryName) continue;
      if (entry.isSymbolicLink()) return null;
      if (entry.isDirectory()) {
        if (isIgnoredDirectoryName) continue;
        pendingDirectories.push(absolutePath);
        continue;
      }
      if (!entry.isFile() || isTestlikeFilename(absolutePath)) continue;
      if (SOURCE_PROJECT_MDX_FILE_PATTERN.test(entry.name)) {
        hasOpaqueMdxConsumerSurface = true;
        continue;
      }
      if (!SOURCE_PROJECT_FILE_PATTERN.test(entry.name)) continue;
      if (SOURCE_PROJECT_DECLARATION_FILE_PATTERN.test(entry.name)) continue;
      sourceFilePaths.push(normalizeFilename(absolutePath));
    }
  }

  return { sourceFilePaths, hasOpaqueMdxConsumerSurface };
};

const getRuntimeModuleSource = (node: EsTreeNode): string | null => {
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
): void => {
  walkAst(module.programNode, (node) => {
    const source = getRuntimeModuleSource(node);
    if (!source) return;
    const resolvedSourcePath = resolveModulePath(module.filePath, source);
    if (!resolvedSourcePath) {
      unresolvedRuntimeSources.add(source);
      return;
    }
    const normalizedSourcePath = normalizeFilename(resolvedSourcePath);
    resolvedSourcePathByNode.set(node, normalizedSourcePath);
    const consumerModules = consumerModulesByFilePath.get(normalizedSourcePath) ?? new Set();
    consumerModules.add(module);
    consumerModulesByFilePath.set(normalizedSourcePath, consumerModules);
  });
};

export const buildSourceProjectIndex = (
  rootDirectory: string,
  currentFilePath: string,
  currentProgramNode: EsTreeNodeOfType<"Program">,
  currentScopes: ScopeAnalysis,
): SourceProjectIndex | null => {
  const productionSourceFiles = listProductionSourceFiles(rootDirectory);
  if (!productionSourceFiles) return null;
  const modulesByFilePath = new Map<string, SourceProjectModule>();
  for (const filePath of productionSourceFiles.sourceFilePaths) {
    if (filePath === currentFilePath) {
      modulesByFilePath.set(filePath, {
        filePath,
        programNode: currentProgramNode,
        scopes: currentScopes,
      });
      continue;
    }
    const parsedProgram = parseSourceFile(filePath);
    if (!parsedProgram || !isNodeOfType(parsedProgram, "Program")) return null;
    modulesByFilePath.set(filePath, {
      filePath,
      programNode: parsedProgram,
      scopes: getSourceProjectModuleScopes(parsedProgram),
    });
  }

  const consumerModulesByFilePath = new Map<string, Set<SourceProjectModule>>();
  const resolvedSourcePathByNode = new WeakMap<EsTreeNode, string>();
  const unresolvedRuntimeSources = new Set<string>();
  for (const module of modulesByFilePath.values()) {
    indexModuleSources(
      module,
      consumerModulesByFilePath,
      resolvedSourcePathByNode,
      unresolvedRuntimeSources,
    );
  }

  return {
    modulesByFilePath,
    consumerModulesByFilePath,
    resolvedSourcePathByNode,
    unresolvedRuntimeSources,
    hasOpaqueMdxConsumerSurface: productionSourceFiles.hasOpaqueMdxConsumerSurface,
  };
};
