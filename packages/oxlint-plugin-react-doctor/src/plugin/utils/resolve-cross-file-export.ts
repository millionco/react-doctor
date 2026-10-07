import type { EsTreeNode } from "./es-tree-node.js";
import { isFunctionLike } from "./is-function-like.js";
import { resolveCrossFileValueExportWithFilePath } from "./resolve-cross-file-function-export.js";

export interface ResolvedCrossFileExport {
  readonly filePath: string;
  readonly node: EsTreeNode;
  readonly programNode: EsTreeNode;
  readonly kind: "function" | "initializer";
}
export const resolveCrossFileExport = (
  fromFilename: string,
  specifier: string,
  exportedName: string,
): ResolvedCrossFileExport | null => {
  const resolvedExport = resolveCrossFileValueExportWithFilePath(
    fromFilename,
    specifier,
    exportedName,
  );
  if (!resolvedExport) return null;
  return {
    filePath: resolvedExport.filePath,
    node: resolvedExport.exportedNode,
    programNode: resolvedExport.programNode,
    kind: isFunctionLike(resolvedExport.exportedNode) ? "function" : "initializer",
  };
};
