import { dirname } from "node:path";
import { existsSync } from "node:fs";
import fg from "fast-glob";
import type { DeslopError, ResolvedEntries, SourceFile } from "../types.js";
import { ResolverError, WorkspaceError, describeUnknownError } from "../errors.js";
import { parseSourceFile, type ParsedSource } from "../collect/parse.js";
import type { ResolvedImport } from "../resolver/resolve.js";
import type { ModuleLinkInput } from "./build.js";

interface BuildModuleLinkInputsOptions {
  files: SourceFile[];
  parsedModules: ParsedSource[];
  resolvedEntries: ResolvedEntries;
  gitIgnoredFilePaths: ReadonlySet<string>;
  resolveModule: (specifier: string, fromFile: string) => ResolvedImport;
}

interface ModuleLinkInputsResult {
  graphInputs: ModuleLinkInput[];
  errors: DeslopError[];
}

interface ModuleResolutionContext {
  errors: DeslopError[];
  resolveModule: (specifier: string, fromFile: string) => ResolvedImport;
}

interface StyleDiscoveryContext extends ModuleResolutionContext {
  discoveredFilePaths: Set<string>;
  pendingStyleFilePaths: Set<string>;
  styleFileQueue: string[];
}

const STYLE_EXTENSIONS = [".css", ".scss"];

const isStyleFile = (filePath: string): boolean =>
  STYLE_EXTENSIONS.some((extension) => filePath.endsWith(extension));

const unresolvedImport = (): ResolvedImport => ({
  resolvedPath: undefined,
  isExternal: false,
  packageName: undefined,
});

const resolveImport = (
  context: ModuleResolutionContext,
  specifier: string,
  fromFilePath: string,
  failureMessage: string,
): ResolvedImport => {
  try {
    return context.resolveModule(specifier, fromFilePath);
  } catch (resolveError) {
    context.errors.push(
      new ResolverError({
        severity: "warning",
        message: failureMessage,
        path: fromFilePath,
        detail: describeUnknownError(resolveError),
      }),
    );
    return unresolvedImport();
  }
};

const expandImportGlob = (
  specifier: string,
  fromFilePath: string,
  errors: DeslopError[],
): string[] => {
  try {
    return fg.sync(specifier, {
      cwd: dirname(fromFilePath),
      absolute: true,
      onlyFiles: true,
      ignore: ["**/node_modules/**"],
    });
  } catch (globError) {
    errors.push(
      new WorkspaceError({
        code: "workspace-discovery-failed",
        message: `fast-glob threw on import glob "${specifier}"`,
        path: fromFilePath,
        detail: describeUnknownError(globError),
      }),
    );
    return [];
  }
};

const collectSourceImports = (
  parsedModule: ParsedSource,
  filePath: string,
  context: ModuleResolutionContext,
): Map<string, ResolvedImport> => {
  const resolvedImports = new Map<string, ResolvedImport>();
  for (const importInfo of parsedModule.imports) {
    if (importInfo.isGlob) {
      for (const expandedFilePath of expandImportGlob(
        importInfo.specifier,
        filePath,
        context.errors,
      )) {
        resolvedImports.set(expandedFilePath, {
          resolvedPath: expandedFilePath,
          isExternal: false,
          packageName: undefined,
        });
      }
      resolvedImports.set(importInfo.specifier, unresolvedImport());
      continue;
    }
    resolvedImports.set(
      importInfo.specifier,
      resolveImport(
        context,
        importInfo.specifier,
        filePath,
        `moduleResolver.resolveModule threw on specifier "${importInfo.specifier}"`,
      ),
    );
  }
  return resolvedImports;
};

const collectReExportImports = (
  parsedModule: ParsedSource,
  filePath: string,
  resolvedImports: Map<string, ResolvedImport>,
  context: ModuleResolutionContext,
): void => {
  for (const exportInfo of parsedModule.exports) {
    if (
      !exportInfo.isReExport ||
      !exportInfo.reExportSource ||
      resolvedImports.has(exportInfo.reExportSource)
    ) {
      continue;
    }
    resolvedImports.set(
      exportInfo.reExportSource,
      resolveImport(
        context,
        exportInfo.reExportSource,
        filePath,
        `moduleResolver.resolveModule threw on specifier "${exportInfo.reExportSource}"`,
      ),
    );
  }
};

const buildSourceModuleLinkInputs = (
  options: BuildModuleLinkInputsOptions,
): ModuleLinkInputsResult => {
  const errors: DeslopError[] = [];
  const productionEntryPaths = new Set(options.resolvedEntries.productionEntries);
  const testEntryPaths = new Set(options.resolvedEntries.testEntries);
  const alwaysUsedFilePaths = new Set(options.resolvedEntries.alwaysUsedFiles);
  const graphInputs: ModuleLinkInput[] = [];
  const resolutionContext: ModuleResolutionContext = {
    errors,
    resolveModule: options.resolveModule,
  };

  for (let fileIndex = 0; fileIndex < options.files.length; fileIndex++) {
    const file = options.files[fileIndex];
    const parsedModule = options.parsedModules[fileIndex];
    const resolvedImports = collectSourceImports(parsedModule, file.path, resolutionContext);
    collectReExportImports(parsedModule, file.path, resolvedImports, resolutionContext);

    graphInputs.push({
      fileId: file,
      parsed: parsedModule,
      resolvedImports,
      isEntryPoint:
        alwaysUsedFilePaths.has(file.path) ||
        productionEntryPaths.has(file.path) ||
        testEntryPaths.has(file.path),
      isTestEntry: testEntryPaths.has(file.path),
      isGitIgnored: options.gitIgnoredFilePaths.has(file.path),
    });
  }

  return { graphInputs, errors };
};

const findUndiscoveredStyleFilePath = (
  resolvedImport: ResolvedImport,
  discoveredFilePaths: ReadonlySet<string>,
): string | undefined => {
  const resolvedPath = resolvedImport.resolvedPath;
  if (
    !resolvedPath ||
    discoveredFilePaths.has(resolvedPath) ||
    !isStyleFile(resolvedPath) ||
    !existsSync(resolvedPath)
  ) {
    return undefined;
  }
  return resolvedPath;
};

const collectPendingStyleFilePaths = (
  sourceGraphInputs: ModuleLinkInput[],
  discoveredFilePaths: ReadonlySet<string>,
): Set<string> => {
  const pendingStyleFilePaths = new Set<string>();
  for (const graphInput of sourceGraphInputs) {
    for (const resolvedImport of graphInput.resolvedImports.values()) {
      if (resolvedImport.isExternal) continue;
      const styleFilePath = findUndiscoveredStyleFilePath(resolvedImport, discoveredFilePaths);
      if (styleFilePath) pendingStyleFilePaths.add(styleFilePath);
    }
  }
  return pendingStyleFilePaths;
};

const collectStyleImports = (
  parsedStyleModule: ParsedSource,
  styleFilePath: string,
  context: StyleDiscoveryContext,
): Map<string, ResolvedImport> => {
  const resolvedStyleImports = new Map<string, ResolvedImport>();
  for (const importInfo of parsedStyleModule.imports) {
    const resolvedImport = resolveImport(
      context,
      importInfo.specifier,
      styleFilePath,
      `moduleResolver.resolveModule threw on style import "${importInfo.specifier}"`,
    );
    resolvedStyleImports.set(importInfo.specifier, resolvedImport);

    const importedStyleFilePath = findUndiscoveredStyleFilePath(
      resolvedImport,
      context.discoveredFilePaths,
    );
    if (!importedStyleFilePath || context.pendingStyleFilePaths.has(importedStyleFilePath)) {
      continue;
    }
    context.pendingStyleFilePaths.add(importedStyleFilePath);
    context.styleFileQueue.push(importedStyleFilePath);
  }
  return resolvedStyleImports;
};

const buildStyleModuleLinkInputs = (
  options: BuildModuleLinkInputsOptions,
  sourceGraphInputs: ModuleLinkInput[],
): ModuleLinkInputsResult => {
  const errors: DeslopError[] = [];
  const graphInputs: ModuleLinkInput[] = [];
  const discoveredFilePaths = new Set(options.files.map((file) => file.path));
  const pendingStyleFilePaths = collectPendingStyleFilePaths(
    sourceGraphInputs,
    discoveredFilePaths,
  );
  const styleFileQueue = [...pendingStyleFilePaths].sort();
  const discoveryContext: StyleDiscoveryContext = {
    discoveredFilePaths,
    errors,
    pendingStyleFilePaths,
    resolveModule: options.resolveModule,
    styleFileQueue,
  };
  let nextFileIndex = options.files.length;
  for (let queueIndex = 0; queueIndex < styleFileQueue.length; queueIndex++) {
    const styleFilePath = styleFileQueue[queueIndex];
    if (discoveredFilePaths.has(styleFilePath)) continue;

    const parsedStyleModule = parseSourceFile(styleFilePath);
    const resolvedStyleImports = collectStyleImports(
      parsedStyleModule,
      styleFilePath,
      discoveryContext,
    );

    graphInputs.push({
      fileId: { index: nextFileIndex, path: styleFilePath },
      parsed: parsedStyleModule,
      resolvedImports: resolvedStyleImports,
      isEntryPoint: false,
      isTestEntry: false,
      isGitIgnored: options.gitIgnoredFilePaths.has(styleFilePath),
    });
    discoveredFilePaths.add(styleFilePath);
    nextFileIndex++;
  }

  return { graphInputs, errors };
};

export const buildModuleLinkInputs = (
  options: BuildModuleLinkInputsOptions,
): ModuleLinkInputsResult => {
  const sourceResult = buildSourceModuleLinkInputs(options);
  const styleResult = buildStyleModuleLinkInputs(options, sourceResult.graphInputs);
  return {
    graphInputs: [...sourceResult.graphInputs, ...styleResult.graphInputs],
    errors: [...sourceResult.errors, ...styleResult.errors],
  };
};
