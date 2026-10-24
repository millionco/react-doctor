import * as fs from "node:fs";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { isEverySpecifierInlineType, isTypeOnlyImport } from "./is-type-only-import.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { listProductionSourceFiles } from "./list-production-source-files.js";
import type { ProductionSourceFileLimits } from "./list-production-source-files.js";
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
  readonly htmlFilePaths: ReadonlyArray<string>;
  readonly consumerModulesByFilePath: ReadonlyMap<string, ReadonlySet<SourceProjectModule>>;
  readonly resolvedSourcePathByNode: WeakMap<EsTreeNode, string>;
  readonly unresolvedRuntimeSources: ReadonlySet<string>;
  readonly hasOpaqueMdxConsumerSurface: boolean;
}

export interface SourceProjectIndexInput {
  readonly rootDirectory: string;
  readonly currentFilePath: string;
  readonly currentProgramNode: EsTreeNodeOfType<"Program">;
  readonly currentScopes?: ScopeAnalysis;
  readonly requiredModuleSources?: ReadonlyArray<string>;
  readonly knownModuleSources?: ReadonlyArray<string>;
  readonly sourceFileLimits?: ProductionSourceFileLimits;
}

const sourceProjectScopeCache = new WeakMap<EsTreeNodeOfType<"Program">, ScopeAnalysis>();

const getSourceProjectModuleScopes = (programNode: EsTreeNodeOfType<"Program">): ScopeAnalysis => {
  const cachedScopes = sourceProjectScopeCache.get(programNode);
  if (cachedScopes) return cachedScopes;
  const scopes = analyzeScopes(programNode);
  sourceProjectScopeCache.set(programNode, scopes);
  return scopes;
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

export const buildSourceProjectIndex = ({
  rootDirectory,
  currentFilePath,
  currentProgramNode,
  currentScopes,
  requiredModuleSources = [],
  knownModuleSources,
  sourceFileLimits,
}: SourceProjectIndexInput): SourceProjectIndex | null => {
  if (
    requiredModuleSources.length > 0 &&
    knownModuleSources !== undefined &&
    !requiredModuleSources.some((moduleSource) => knownModuleSources.includes(moduleSource))
  ) {
    return null;
  }
  const productionSourceFiles = listProductionSourceFiles(rootDirectory, sourceFileLimits);
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
        get scopes() {
          return currentScopes ?? getSourceProjectModuleScopes(currentProgramNode);
        },
      });
      continue;
    }
    const parsedProgram = parseSourceFile(filePath);
    if (!parsedProgram || !isNodeOfType(parsedProgram, "Program")) return null;
    modulesByFilePath.set(filePath, {
      filePath,
      programNode: parsedProgram,
      get scopes() {
        return getSourceProjectModuleScopes(parsedProgram);
      },
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
    htmlFilePaths: productionSourceFiles.htmlFilePaths,
    consumerModulesByFilePath,
    resolvedSourcePathByNode,
    unresolvedRuntimeSources,
    hasOpaqueMdxConsumerSurface: productionSourceFiles.hasOpaqueMdxConsumerSurface,
  };
};
