import { CROSS_FILE_BARREL_FOLLOW_DEPTH } from "../constants/thresholds.js";
import type { EsTreeNode } from "./es-tree-node.js";
import {
  findExportedConstInitializer,
  findExportedFunctionBody,
  findReExportTargetsForName,
} from "./find-exported-function-body.js";
import { parseSourceFile } from "./parse-source-file.js";
import { resolveImportWithOxc } from "./resolve-import-with-oxc.js";

// Cross-file export resolution built on `resolveImportWithOxc`. oxc-resolver
// does not report its filesystem probe set, so a resolution through this
// util CANNOT be probe-fingerprinted by the sidecar lint cache's dependency
// collectors (`cross-file-dependencies.ts`). Any rule that reaches this util
// (directly or transitively) MUST therefore be classified in
// `UNBOUNDED_CROSS_FILE_RULE_IDS` — re-linting every file on every scan —
// and MUST NOT ship a collector in `CROSS_FILE_DEPENDENCY_COLLECTORS`.
// `cross-file-rule-ids.test.ts` in @react-doctor/core lists this file as a
// cross-file primitive so an unclassified consumer fails the guard.

export interface ResolvedCrossFileExport {
  /** Absolute path of the file that owns the export (after barrel hops). */
  readonly filePath: string;
  readonly node: EsTreeNode;
  /**
   * "function" — the export is a function declaration / function
   * expression / arrow (`node` is the function node); "initializer" — the
   * export is a `const X = <expr>` binding (`node` is the initializer
   * expression).
   */
  readonly kind: "function" | "initializer";
}

const resolveExportInFile = (
  filePath: string,
  exportedName: string,
  visitedFilePaths: Set<string>,
): ResolvedCrossFileExport | null => {
  if (visitedFilePaths.size >= CROSS_FILE_BARREL_FOLLOW_DEPTH) return null;
  if (visitedFilePaths.has(filePath)) return null;
  visitedFilePaths.add(filePath);

  const programRoot = parseSourceFile(filePath);
  if (!programRoot) return null;

  const functionNode = findExportedFunctionBody(programRoot, exportedName);
  if (functionNode) return { filePath, node: functionNode, kind: "function" };

  const initializerNode = findExportedConstInitializer(programRoot, exportedName);
  if (initializerNode) return { filePath, node: initializerNode, kind: "initializer" };

  for (const reExportTarget of findReExportTargetsForName(programRoot, exportedName)) {
    const nextFilePath = resolveImportWithOxc(filePath, reExportTarget.source);
    if (!nextFilePath) continue;
    const resolved = resolveExportInFile(
      nextFilePath,
      reExportTarget.importedName,
      visitedFilePaths,
    );
    if (resolved) return resolved;
  }

  return null;
};

// Resolves `import { exportedName } from "specifier"` as written in
// `fromFilename` to the exported function body or const-initializer
// expression, following barrel re-exports (including renames and
// `export *`) up to CROSS_FILE_BARREL_FOLLOW_DEPTH files. Hops parse
// through the `parseSourceFile` cache. Returns null when the specifier
// doesn't resolve (or lands in node_modules) or the name can't be bound
// to a function / initializer in a resolvable file.
export const resolveCrossFileExport = (
  fromFilename: string,
  specifier: string,
  exportedName: string,
): ResolvedCrossFileExport | null => {
  const resolvedFilePath = resolveImportWithOxc(fromFilename, specifier);
  if (!resolvedFilePath) return null;
  return resolveExportInFile(resolvedFilePath, exportedName, new Set<string>());
};
