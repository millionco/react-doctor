import { CROSS_FILE_BARREL_FOLLOW_DEPTH } from "../constants/thresholds.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findReExportTargetsForName } from "./find-exported-function-body.js";
import { findExportedValue } from "./find-exported-value.js";
import { isFunctionLike } from "./is-function-like.js";
import { parseSourceFile } from "./parse-source-file.js";
import { resolveModulePath } from "./resolve-module-path.js";

export interface ResolvedCrossFileFunctionExport {
  readonly filePath: string;
  readonly functionNode: EsTreeNode;
  readonly programNode: EsTreeNode;
}

export interface ResolvedCrossFileValueExport {
  readonly filePath: string;
  readonly exportedNode: EsTreeNode;
  readonly programNode: EsTreeNode;
}

const resolveValueExportInFile = (
  filePath: string,
  exportedName: string,
  visitedFilePaths: Set<string>,
): ResolvedCrossFileValueExport | null => {
  if (visitedFilePaths.size >= CROSS_FILE_BARREL_FOLLOW_DEPTH) return null;
  if (visitedFilePaths.has(filePath)) return null;
  visitedFilePaths.add(filePath);

  const programRoot = parseSourceFile(filePath);
  if (!programRoot) return null;

  const exported = findExportedValue(programRoot, exportedName);
  if (exported) return { filePath, exportedNode: exported, programNode: programRoot };

  const resolvedCandidates = new Map<EsTreeNode, ResolvedCrossFileValueExport>();
  for (const target of findReExportTargetsForName(programRoot, exportedName)) {
    const nextFilePath = resolveModulePath(filePath, target.source);
    if (!nextFilePath) continue;
    const resolved = resolveValueExportInFile(
      nextFilePath,
      target.importedName,
      new Set(visitedFilePaths),
    );
    if (resolved) resolvedCandidates.set(resolved.exportedNode, resolved);
  }

  if (resolvedCandidates.size !== 1) return null;
  return resolvedCandidates.values().next().value ?? null;
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
): ResolvedCrossFileFunctionExport | null => {
  const resolved = resolveCrossFileValueExportWithFilePath(fromFilename, source, exportedName);
  if (!resolved || !isFunctionLike(resolved.exportedNode)) return null;
  return {
    filePath: resolved.filePath,
    functionNode: resolved.exportedNode,
    programNode: resolved.programNode,
  };
};

export const resolveCrossFileValueExportWithFilePath = (
  fromFilename: string,
  source: string,
  exportedName: string,
): ResolvedCrossFileValueExport | null => {
  const resolvedFilePath = resolveModulePath(fromFilename, source);
  if (!resolvedFilePath) return null;
  return resolveValueExportInFile(resolvedFilePath, exportedName, new Set<string>());
};
