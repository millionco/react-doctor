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

const STYLE_EXTENSIONS = [".css", ".scss"];

const isStyleFile = (filePath: string): boolean =>
  STYLE_EXTENSIONS.some((extension) => filePath.endsWith(extension));

const unresolvedImport = (): ResolvedImport => ({
  resolvedPath: undefined,
  isExternal: false,
  packageName: undefined,
});

const buildSourceModuleLinkInputs = (
  options: BuildModuleLinkInputsOptions,
): ModuleLinkInputsResult => {
  const errors: DeslopError[] = [];
  const productionEntryPaths = new Set(options.resolvedEntries.productionEntries);
  const testEntryPaths = new Set(options.resolvedEntries.testEntries);
  const alwaysUsedFilePaths = new Set(options.resolvedEntries.alwaysUsedFiles);
  const graphInputs: ModuleLinkInput[] = [];

  for (let fileIndex = 0; fileIndex < options.files.length; fileIndex++) {
    const file = options.files[fileIndex];
    const parsedModule = options.parsedModules[fileIndex];
    const resolvedImports = new Map<string, ResolvedImport>();
    const safelyResolveImport = (specifier: string): ResolvedImport => {
      try {
        return options.resolveModule(specifier, file.path);
      } catch (resolveError) {
        errors.push(
          new ResolverError({
            severity: "warning",
            message: `moduleResolver.resolveModule threw on specifier "${specifier}"`,
            path: file.path,
            detail: describeUnknownError(resolveError),
          }),
        );
        return unresolvedImport();
      }
    };

    for (const importInfo of parsedModule.imports) {
      if (importInfo.isGlob) {
        let expandedFilePaths: string[] = [];
        try {
          expandedFilePaths = fg.sync(importInfo.specifier, {
            cwd: dirname(file.path),
            absolute: true,
            onlyFiles: true,
            ignore: ["**/node_modules/**"],
          });
        } catch (globError) {
          errors.push(
            new WorkspaceError({
              code: "workspace-discovery-failed",
              message: `fast-glob threw on import glob "${importInfo.specifier}"`,
              path: file.path,
              detail: describeUnknownError(globError),
            }),
          );
        }
        for (const expandedFilePath of expandedFilePaths) {
          resolvedImports.set(expandedFilePath, {
            resolvedPath: expandedFilePath,
            isExternal: false,
            packageName: undefined,
          });
        }
        resolvedImports.set(importInfo.specifier, unresolvedImport());
        continue;
      }
      resolvedImports.set(importInfo.specifier, safelyResolveImport(importInfo.specifier));
    }

    for (const exportInfo of parsedModule.exports) {
      if (
        exportInfo.isReExport &&
        exportInfo.reExportSource &&
        !resolvedImports.has(exportInfo.reExportSource)
      ) {
        resolvedImports.set(
          exportInfo.reExportSource,
          safelyResolveImport(exportInfo.reExportSource),
        );
      }
    }

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

const buildStyleModuleLinkInputs = (
  options: BuildModuleLinkInputsOptions,
  sourceGraphInputs: ModuleLinkInput[],
): ModuleLinkInputsResult => {
  const errors: DeslopError[] = [];
  const graphInputs: ModuleLinkInput[] = [];
  const discoveredFilePaths = new Set(options.files.map((file) => file.path));
  const pendingStyleFilePaths = new Set<string>();
  for (const graphInput of sourceGraphInputs) {
    for (const resolvedImport of graphInput.resolvedImports.values()) {
      if (
        resolvedImport.resolvedPath &&
        !resolvedImport.isExternal &&
        !discoveredFilePaths.has(resolvedImport.resolvedPath) &&
        isStyleFile(resolvedImport.resolvedPath) &&
        existsSync(resolvedImport.resolvedPath)
      ) {
        pendingStyleFilePaths.add(resolvedImport.resolvedPath);
      }
    }
  }

  const styleFileQueue = [...pendingStyleFilePaths].sort();
  let nextFileIndex = options.files.length;
  for (let queueIndex = 0; queueIndex < styleFileQueue.length; queueIndex++) {
    const styleFilePath = styleFileQueue[queueIndex];
    if (discoveredFilePaths.has(styleFilePath)) continue;

    const parsedStyleModule = parseSourceFile(styleFilePath);
    const resolvedStyleImports = new Map<string, ResolvedImport>();
    for (const importInfo of parsedStyleModule.imports) {
      let resolvedImport: ResolvedImport;
      try {
        resolvedImport = options.resolveModule(importInfo.specifier, styleFilePath);
      } catch (styleResolveError) {
        errors.push(
          new ResolverError({
            severity: "warning",
            message: `moduleResolver.resolveModule threw on style import "${importInfo.specifier}"`,
            path: styleFilePath,
            detail: describeUnknownError(styleResolveError),
          }),
        );
        resolvedImport = unresolvedImport();
      }
      resolvedStyleImports.set(importInfo.specifier, resolvedImport);
      if (
        resolvedImport.resolvedPath &&
        !discoveredFilePaths.has(resolvedImport.resolvedPath) &&
        isStyleFile(resolvedImport.resolvedPath) &&
        !pendingStyleFilePaths.has(resolvedImport.resolvedPath) &&
        existsSync(resolvedImport.resolvedPath)
      ) {
        pendingStyleFilePaths.add(resolvedImport.resolvedPath);
        styleFileQueue.push(resolvedImport.resolvedPath);
      }
    }

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
