import { CROSS_FILE_BARREL_FOLLOW_DEPTH } from "../constants/thresholds.js";
import type { EsTreeNode } from "./es-tree-node.js";
import {
  findExportedFunctionBody,
  findReExportTargetsForName,
} from "./find-exported-function-body.js";
import { parseSourceFile } from "./parse-source-file.js";
import { resolveModulePath } from "./resolve-module-path.js";

const resolveFunctionExportInFile = (
  filePath: string,
  exportedName: string,
  visitedFilePaths: Set<string>,
): EsTreeNode | null => {
  if (visitedFilePaths.size >= CROSS_FILE_BARREL_FOLLOW_DEPTH) return null;
  if (visitedFilePaths.has(filePath)) return null;
  visitedFilePaths.add(filePath);

  const programRoot = parseSourceFile(filePath);
  if (!programRoot) return null;

  const exported = findExportedFunctionBody(programRoot, exportedName);
  if (exported) return exported;

  const resolvedCandidates = new Set<EsTreeNode>();
  for (const target of findReExportTargetsForName(programRoot, exportedName)) {
    const nextFilePath = resolveModulePath(filePath, target.source);
    if (!nextFilePath) continue;
    const resolved = resolveFunctionExportInFile(
      nextFilePath,
      target.importedName,
      new Set(visitedFilePaths),
    );
    if (resolved) resolvedCandidates.add(resolved);
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
  const resolvedFilePath = resolveModulePath(fromFilename, source);
  if (!resolvedFilePath) return null;
  return resolveFunctionExportInFile(resolvedFilePath, exportedName, new Set<string>());
};
