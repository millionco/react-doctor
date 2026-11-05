import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { parseSourceFile } from "./parse-source-file.js";
import { resolveModulePath } from "./resolve-module-path.js";

export const resolveDirectDynamicImportModule = (
  filename: string,
  specifier: string,
): EsTreeNodeOfType<"Program"> | null => {
  const resolvedPath = resolveModulePath(filename, specifier);
  const program = resolvedPath ? parseSourceFile(resolvedPath) : null;
  return isNodeOfType(program, "Program") ? program : null;
};
