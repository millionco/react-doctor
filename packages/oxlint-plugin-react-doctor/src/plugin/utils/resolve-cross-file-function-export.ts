import { CROSS_FILE_BARREL_FOLLOW_DEPTH } from "../constants/thresholds.js";
import type { EsTreeNode } from "./es-tree-node.js";
import {
  findExportedFunctionBody,
  findReExportSourcesForName,
} from "./find-exported-function-body.js";
import { parseSourceFile } from "./parse-source-file.js";
import { resolveBarrelExportFilePath } from "./resolve-barrel-export-file-path.js";
import { resolveModulePath } from "./resolve-module-path.js";

const resolveFunctionExportInFile = (
  filePath: string,
  exportedName: string,
  visitedFilePaths: Set<string>,
): EsTreeNode | null => {
  if (visitedFilePaths.size >= CROSS_FILE_BARREL_FOLLOW_DEPTH) return null;
  if (visitedFilePaths.has(filePath)) return null;
  visitedFilePaths.add(filePath);

  // Barrel files re-export from other files. Resolve the barrel first
  // so we land on the file that owns the function.
  const barrelTargetPath = resolveBarrelExportFilePath(filePath, exportedName);
  const actualFilePath = barrelTargetPath ?? filePath;

  const programRoot = parseSourceFile(actualFilePath);
  if (!programRoot) return null;

  const exported = findExportedFunctionBody(programRoot, exportedName);
  if (exported) return exported;

  // The export might be a re-export not handled by the barrel resolver.
  // Probe each candidate re-export source in turn — a matching named
  // re-export is precise, otherwise every `export *` is tried until one
  // resolves.
  for (const reExportSource of findReExportSourcesForName(programRoot, exportedName)) {
    const nextFilePath = resolveModulePath(actualFilePath, reExportSource);
    if (!nextFilePath) continue;
    const resolved = resolveFunctionExportInFile(nextFilePath, exportedName, visitedFilePaths);
    if (resolved) return resolved;
  }

  return null;
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
