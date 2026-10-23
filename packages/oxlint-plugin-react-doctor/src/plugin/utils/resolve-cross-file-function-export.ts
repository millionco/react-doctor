import * as fs from "node:fs";
import * as path from "node:path";
import { CROSS_FILE_BARREL_FOLLOW_DEPTH } from "../constants/thresholds.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findReExportTargetsForName } from "./find-exported-function-body.js";
import { findExportedValue } from "./find-exported-value.js";
import { collectPatternNames } from "./collect-pattern-names.js";
import { getModuleSpecifierName } from "./get-module-specifier-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isFunctionLike } from "./is-function-like.js";
import { parseSourceFile } from "./parse-source-file.js";
import { resolveModulePath } from "./resolve-module-path.js";
import {
  captureCrossFileProbes,
  isProbeRecorderActive,
  recordContentProbe,
  recordExistenceProbe,
} from "./cross-file-probe-recorder.js";
import type { CrossFileProbeTrace } from "./cross-file-probe-recorder.js";

export interface ResolvedCrossFileFunctionExport {
  readonly filePath: string;
  readonly functionNode: EsTreeNode;
  readonly programNode: EsTreeNode;
  readonly contexts?: readonly CrossFileExportContext[];
}

export interface ResolvedCrossFileValueExport {
  readonly filePath: string;
  readonly exportedNode: EsTreeNode;
  readonly programNode: EsTreeNode;
  readonly contexts?: readonly CrossFileExportContext[];
}

export interface CrossFileExportOptions {
  readonly requireCompleteReexports?: boolean;
}

export interface CrossFileExportContext {
  readonly filePath: string;
  readonly programNode: EsTreeNode;
  readonly role: "definition" | "forwarder" | "absent";
}

interface CrossFileValueExportTraversal {
  readonly result: ResolvedCrossFileValueExport | null;
  readonly complete: boolean;
  readonly contexts: readonly CrossFileExportContext[];
}

interface CrossFileValueExportLookup {
  readonly result: ResolvedCrossFileValueExport | null;
  readonly trace: CrossFileProbeTrace;
}

const crossFileValueExportByImport = new Map<string, CrossFileValueExportLookup>();

export const resetCrossFileExportCaches = (): void => {
  crossFileValueExportByImport.clear();
};

const resolveValueExportInFile = (
  filePath: string,
  exportedName: string,
  visitedFilePaths: Set<string>,
  options: CrossFileExportOptions,
): CrossFileValueExportTraversal => {
  const incomplete: CrossFileValueExportTraversal = { result: null, complete: false, contexts: [] };
  if (visitedFilePaths.size >= CROSS_FILE_BARREL_FOLLOW_DEPTH) return incomplete;
  if (visitedFilePaths.has(filePath)) return incomplete;
  visitedFilePaths.add(filePath);
  if (options.requireCompleteReexports) {
    recordExistenceProbe(filePath);
    try {
      if (
        fs.lstatSync(filePath).isSymbolicLink() ||
        fs.realpathSync(filePath) !== path.resolve(filePath)
      )
        return incomplete;
    } catch {
      return incomplete;
    }
  }
  const programRoot = parseSourceFile(filePath);
  if (!programRoot) return incomplete;
  if (options.requireCompleteReexports) {
    if (!isNodeOfType(programRoot, "Program")) return incomplete;
    if (
      programRoot.body.some(
        (statement) =>
          isNodeOfType(statement, "TSExportAssignment") ||
          isNodeOfType(statement, "TSNamespaceExportDeclaration") ||
          isNodeOfType(statement, "TSImportEqualsDeclaration"),
      )
    )
      return incomplete;
  }
  const exported = findExportedValue(programRoot, exportedName);
  if (exported) {
    const context: CrossFileExportContext = {
      filePath,
      programNode: programRoot,
      role: "definition",
    };
    return {
      result: { filePath, exportedNode: exported, programNode: programRoot },
      complete: true,
      contexts: [context],
    };
  }
  const targets = findReExportTargetsForName(programRoot, exportedName);
  let hasExplicitForwarder = false;
  if (options.requireCompleteReexports) {
    if (!isNodeOfType(programRoot, "Program")) return incomplete;
    let hasOwnName = false;
    for (const statement of programRoot.body) {
      if (
        isNodeOfType(statement, "ExportAllDeclaration") &&
        statement.exportKind !== "type" &&
        statement.exported
      )
        hasOwnName ||= getModuleSpecifierName(statement.exported) === exportedName;
      if (
        isNodeOfType(statement, "ExportNamedDeclaration") &&
        statement.exportKind !== "type" &&
        statement.source
      ) {
        hasExplicitForwarder ||= statement.specifiers.some(
          (specifier) =>
            isNodeOfType(specifier, "ExportSpecifier") &&
            specifier.exportKind !== "type" &&
            getModuleSpecifierName(specifier.exported) === exportedName,
        );
      }
      if (
        !isNodeOfType(statement, "ExportNamedDeclaration") ||
        statement.exportKind === "type" ||
        statement.source
      )
        continue;
      const declaration = statement.declaration;
      if (isNodeOfType(declaration, "VariableDeclaration")) {
        const names = new Set<string>();
        for (const declarator of declaration.declarations)
          collectPatternNames(declarator.id, names);
        hasOwnName ||= names.has(exportedName);
      } else if (
        isNodeOfType(declaration, "FunctionDeclaration") ||
        isNodeOfType(declaration, "ClassDeclaration")
      ) {
        hasOwnName ||= declaration.id?.name === exportedName;
      } else if (
        declaration &&
        !isNodeOfType(declaration, "TSInterfaceDeclaration") &&
        !isNodeOfType(declaration, "TSTypeAliasDeclaration")
      ) {
        return incomplete;
      }
      for (const specifier of statement.specifiers) {
        if (isNodeOfType(specifier, "ExportSpecifier") && specifier.exportKind !== "type")
          hasOwnName ||= getModuleSpecifierName(specifier.exported) === exportedName;
      }
    }
    if (hasOwnName) return incomplete;
  }
  const resolvedCandidates = new Map<EsTreeNode, ResolvedCrossFileValueExport>();
  const contexts: CrossFileExportContext[] = [];
  let complete = true;
  for (const target of targets) {
    if (
      options.requireCompleteReexports &&
      !(target.source.startsWith("./") || target.source.startsWith("../"))
    ) {
      complete = false;
      continue;
    }
    const nextFilePath = resolveModulePath(filePath, target.source);
    if (!nextFilePath) {
      complete = false;
      continue;
    }
    const resolved = resolveValueExportInFile(
      nextFilePath,
      target.importedName,
      new Set(visitedFilePaths),
      options,
    );
    contexts.push(...resolved.contexts);
    complete &&= resolved.complete;
    if (resolved.result) resolvedCandidates.set(resolved.result.exportedNode, resolved.result);
  }
  const context: CrossFileExportContext = {
    filePath,
    programNode: programRoot,
    role: targets.length > 0 ? "forwarder" : "absent",
  };
  contexts.unshift(context);
  const result =
    resolvedCandidates.size === 1 ? (resolvedCandidates.values().next().value ?? null) : null;
  if (
    options.requireCompleteReexports &&
    (!complete ||
      resolvedCandidates.size > 1 ||
      (hasExplicitForwarder && resolvedCandidates.size === 0))
  )
    return { result: null, complete: false, contexts };
  return { result, complete, contexts };
};

// Resolves `import { name } from "source"` (relative or tsconfig-alias)
// to the actual exported function/arrow body, following barrel
// re-exports up to CROSS_FILE_BARREL_FOLLOW_DEPTH levels. Returns null
// when the export can't be bound to a function in a resolvable file.
export const resolveCrossFileFunctionExport = (
  fromFilename: string,
  source: string,
  exportedName: string,
): EsTreeNode | null => {
  return (
    resolveCrossFileFunctionExportWithFilePath(fromFilename, source, exportedName)?.functionNode ??
    null
  );
};

export const resolveCrossFileFunctionExportWithFilePath = (
  fromFilename: string,
  source: string,
  exportedName: string,
  options: CrossFileExportOptions = {},
): ResolvedCrossFileFunctionExport | null => {
  const resolved = resolveCrossFileValueExportWithFilePath(
    fromFilename,
    source,
    exportedName,
    options,
  );
  if (!resolved || !isFunctionLike(resolved.exportedNode)) return null;
  return {
    filePath: resolved.filePath,
    functionNode: resolved.exportedNode,
    programNode: resolved.programNode,
    ...(resolved.contexts ? { contexts: resolved.contexts } : {}),
  };
};

export const resolveCrossFileValueExportWithFilePath = (
  fromFilename: string,
  source: string,
  exportedName: string,
  options: CrossFileExportOptions = {},
): ResolvedCrossFileValueExport | null => {
  if (!isProbeRecorderActive()) {
    const resolvedFilePath = resolveModulePath(fromFilename, source);
    if (!resolvedFilePath) return null;
    const traversal = resolveValueExportInFile(
      resolvedFilePath,
      exportedName,
      new Set<string>(),
      options,
    );
    if (!traversal.result) return null;
    return options.requireCompleteReexports
      ? { ...traversal.result, contexts: traversal.contexts }
      : traversal.result;
  }

  const cacheKey = `${fromFilename}\0${source}\0${exportedName}${options.requireCompleteReexports ? "\0strict" : ""}`;
  const cached = crossFileValueExportByImport.get(cacheKey);
  if (cached !== undefined) {
    for (const contentPath of cached.trace.contentPaths) recordContentProbe(contentPath);
    for (const existencePath of cached.trace.existencePaths) recordExistenceProbe(existencePath);
    return cached.result;
  }

  const captured = captureCrossFileProbes(() => {
    const resolvedFilePath = resolveModulePath(fromFilename, source);
    if (!resolvedFilePath) return null;
    const traversal = resolveValueExportInFile(
      resolvedFilePath,
      exportedName,
      new Set<string>(),
      options,
    );
    if (!traversal.result) return null;
    return options.requireCompleteReexports
      ? { ...traversal.result, contexts: traversal.contexts }
      : traversal.result;
  });
  crossFileValueExportByImport.set(cacheKey, {
    result: captured.value,
    trace: captured.trace,
  });
  return captured.value;
};
