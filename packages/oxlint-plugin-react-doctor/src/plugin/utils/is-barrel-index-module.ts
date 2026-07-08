import * as fs from "node:fs";
import * as path from "node:path";
import { recordContentProbe } from "./cross-file-probe-recorder.js";
import { parseExportSpecifiers } from "./parse-export-specifiers.js";
import { stripJsComments } from "./strip-js-comments.js";

const INDEX_MODULE_FILE_PATTERN = /^index\.(?:[cm]?[jt]sx?|mjs)$/;
const BINDING_IMPORT_DECLARATION_PATTERN =
  /^\s*import\s+(type\s+)?(?!["'])([^;]*?)\s+from\s+["']([^"']+)["']\s*;?\s*(?:(?:\/\/[^\n]*)?\s*)/gm;
const BARREL_REEXPORT_DECLARATION_PATTERN =
  /^\s*export\s+(type\s+)?(?:\*(?:\s+as\s+([\w$]+))?|\{([\s\S]*?)\})\s+from\s+["']([^"']+)["']\s*;?\s*(?:(?:\/\/[^\n]*)?\s*)/gm;
const LOCAL_EXPORT_SPECIFIER_DECLARATION_PATTERN =
  /^\s*export\s+(type\s+)?\{([\s\S]*?)\}\s*;?\s*(?:(?:\/\/[^\n]*)?\s*)/gm;

export interface BarrelExportTarget {
  exportedName: string;
  importedName: string;
  source: string;
  isTypeOnly: boolean;
}

export interface BarrelIndexModuleInfo {
  isBarrel: boolean;
  exportsByName: Map<string, BarrelExportTarget>;
  starExportSources: string[];
}

interface ImportedBinding {
  localName: string;
  importedName: string;
  source: string;
  isTypeOnly: boolean;
  didExport: boolean;
}

interface BarrelInfoCacheEntry {
  mtimeMs: number;
  size: number;
  moduleInfo: BarrelIndexModuleInfo;
}

// Keyed by mtime/size like its siblings (`parse-source-file.ts`,
// `does-module-export-name.ts`) so a long-lived process — the language
// server, repeated `diagnose()` calls — re-reads a barrel that changed on
// disk instead of serving a stale classification.
const barrelIndexModuleInfoCache = new Map<string, BarrelInfoCacheEntry>();

const isIndexModuleFilePath = (filePath: string): boolean =>
  INDEX_MODULE_FILE_PATTERN.test(path.basename(filePath));

const createNonBarrelInfo = (): BarrelIndexModuleInfo => ({
  isBarrel: false,
  exportsByName: new Map<string, BarrelExportTarget>(),
  starExportSources: [],
});

const addImportedBinding = (
  importedBindings: Map<string, ImportedBinding>,
  binding: Omit<ImportedBinding, "didExport">,
): void => {
  importedBindings.set(binding.localName, { ...binding, didExport: false });
};

const collectNamedImportBindings = (
  namedSpecifiersText: string,
  source: string,
  declarationIsTypeOnly: boolean,
  importedBindings: Map<string, ImportedBinding>,
): void => {
  for (const specifier of parseExportSpecifiers(namedSpecifiersText, declarationIsTypeOnly)) {
    addImportedBinding(importedBindings, {
      localName: specifier.exportedName,
      importedName: specifier.localName,
      source,
      isTypeOnly: specifier.isTypeOnly,
    });
  }
};

const collectImportBindings = (
  importClause: string,
  source: string,
  declarationIsTypeOnly: boolean,
  importedBindings: Map<string, ImportedBinding>,
): void => {
  const trimmedImportClause = importClause.trim();
  const namespaceMatch = trimmedImportClause.match(/(?:^|,\s*)\*\s+as\s+([\w$]+)/);
  if (namespaceMatch?.[1]) {
    addImportedBinding(importedBindings, {
      localName: namespaceMatch[1],
      importedName: "*",
      source,
      isTypeOnly: declarationIsTypeOnly,
    });
  }

  const namedImportMatch = trimmedImportClause.match(/\{([\s\S]*?)\}/);
  if (namedImportMatch?.[1]) {
    collectNamedImportBindings(
      namedImportMatch[1],
      source,
      declarationIsTypeOnly,
      importedBindings,
    );
  }

  const defaultImportName = trimmedImportClause.split(",")[0]?.trim();
  if (
    defaultImportName &&
    !defaultImportName.startsWith("{") &&
    !defaultImportName.startsWith("*")
  ) {
    addImportedBinding(importedBindings, {
      localName: defaultImportName,
      importedName: "default",
      source,
      isTypeOnly: declarationIsTypeOnly,
    });
  }
};

const replaceKnownDeclarations = (
  sourceText: string,
  importedBindings: Map<string, ImportedBinding>,
  exportsByName: Map<string, BarrelExportTarget>,
  starExportSources: string[],
): string => {
  let withoutKnownDeclarations = sourceText.replace(
    BINDING_IMPORT_DECLARATION_PATTERN,
    (_match, typeKeyword: string | undefined, importClause: string, source: string) => {
      collectImportBindings(importClause, source, Boolean(typeKeyword), importedBindings);
      return "";
    },
  );

  withoutKnownDeclarations = withoutKnownDeclarations.replace(
    BARREL_REEXPORT_DECLARATION_PATTERN,
    (
      _match,
      typeKeyword: string | undefined,
      namespaceExportName: string | undefined,
      specifiersText: string | undefined,
      source: string,
    ) => {
      const isTypeOnly = Boolean(typeKeyword);
      if (namespaceExportName) {
        exportsByName.set(namespaceExportName, {
          exportedName: namespaceExportName,
          importedName: "*",
          source,
          isTypeOnly,
        });
        return "";
      }

      if (specifiersText) {
        for (const specifier of parseExportSpecifiers(specifiersText, isTypeOnly)) {
          exportsByName.set(specifier.exportedName, {
            exportedName: specifier.exportedName,
            importedName: specifier.localName,
            source,
            isTypeOnly: specifier.isTypeOnly,
          });
        }
        return "";
      }

      starExportSources.push(source);
      return "";
    },
  );

  withoutKnownDeclarations = withoutKnownDeclarations.replace(
    LOCAL_EXPORT_SPECIFIER_DECLARATION_PATTERN,
    (_match, typeKeyword: string | undefined, specifiersText: string) => {
      for (const specifier of parseExportSpecifiers(specifiersText, Boolean(typeKeyword))) {
        const importedBinding = importedBindings.get(specifier.localName);
        if (!importedBinding) return _match;

        importedBinding.didExport = true;
        exportsByName.set(specifier.exportedName, {
          exportedName: specifier.exportedName,
          importedName: importedBinding.importedName,
          source: importedBinding.source,
          isTypeOnly: specifier.isTypeOnly || importedBinding.isTypeOnly,
        });
      }
      return "";
    },
  );

  return withoutKnownDeclarations;
};

const hasUnexportedRuntimeImport = (importedBindings: Map<string, ImportedBinding>): boolean => {
  for (const binding of importedBindings.values()) {
    if (!binding.isTypeOnly && !binding.didExport) return true;
  }
  return false;
};

const classifyBarrelModule = (sourceText: string): BarrelIndexModuleInfo => {
  const strippedSource = stripJsComments(sourceText).trim();
  if (!strippedSource) return createNonBarrelInfo();

  const importedBindings = new Map<string, ImportedBinding>();
  const exportsByName = new Map<string, BarrelExportTarget>();
  const starExportSources: string[] = [];
  const remainingSource = replaceKnownDeclarations(
    strippedSource,
    importedBindings,
    exportsByName,
    starExportSources,
  ).trim();

  if (remainingSource || hasUnexportedRuntimeImport(importedBindings)) {
    return createNonBarrelInfo();
  }

  const hasBarrelExport = exportsByName.size > 0 || starExportSources.length > 0;
  return {
    isBarrel: hasBarrelExport,
    exportsByName,
    starExportSources,
  };
};

export const getBarrelIndexModuleInfo = (filePath: string): BarrelIndexModuleInfo => {
  // Non-index paths never touch the filesystem — the answer is a pure
  // function of the filename, so no probe is recorded for them.
  if (!isIndexModuleFilePath(filePath)) return createNonBarrelInfo();

  // Recorded BEFORE the cache lookup: the classification is a pure function
  // of this one file's content, so the content probe alone captures the
  // dependency while the cache stays warm (see cross-file-probe-recorder.ts).
  recordContentProbe(filePath);

  let fileStat: fs.Stats | null;
  try {
    fileStat = fs.statSync(filePath);
  } catch {
    fileStat = null;
  }
  const cachedResult = barrelIndexModuleInfoCache.get(filePath);
  if (
    cachedResult !== undefined &&
    fileStat !== null &&
    cachedResult.mtimeMs === fileStat.mtimeMs &&
    cachedResult.size === fileStat.size
  ) {
    return cachedResult.moduleInfo;
  }
  if (fileStat === null) return createNonBarrelInfo();

  let moduleInfo = createNonBarrelInfo();
  try {
    moduleInfo = classifyBarrelModule(fs.readFileSync(filePath, "utf8"));
  } catch {
    moduleInfo = createNonBarrelInfo();
  }

  barrelIndexModuleInfoCache.set(filePath, {
    mtimeMs: fileStat.mtimeMs,
    size: fileStat.size,
    moduleInfo,
  });
  return moduleInfo;
};

export const isBarrelIndexModule = (filePath: string): boolean =>
  getBarrelIndexModuleInfo(filePath).isBarrel;
