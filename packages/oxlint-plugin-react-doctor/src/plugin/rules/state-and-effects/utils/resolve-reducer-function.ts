import { CROSS_FILE_BARREL_FOLLOW_DEPTH } from "../../../constants/thresholds.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import {
  findExportedFunctionBody,
  findReExportSourcesForName,
  resolveImportedExportName,
} from "../../../utils/find-exported-function-body.js";
import { findVariableInitializer } from "../../../utils/find-variable-initializer.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { parseSourceFile } from "../../../utils/parse-source-file.js";
import { resolveBarrelExportFilePath } from "../../../utils/resolve-barrel-export-file-path.js";
import { resolveRelativeImportPath } from "../../../utils/resolve-relative-import-path.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";

export interface ResolvedReducer {
  readonly functionNode: EsTreeNode;
  // When non-null, the reducer body comes from a different file. The
  // display path (relative when possible, else absolute) is woven
  // into the diagnostic message.
  readonly crossFileSourceDisplay: string | null;
}

const resolveFunctionExportInFile = (
  filePath: string,
  exportedName: string,
  visitedFilePaths: Set<string>,
): EsTreeNode | null => {
  if (visitedFilePaths.size >= CROSS_FILE_BARREL_FOLLOW_DEPTH) return null;
  if (visitedFilePaths.has(filePath)) return null;
  visitedFilePaths.add(filePath);

  // Barrel files re-export from other files. Resolve the barrel
  // first so we land on the file that owns the function.
  const barrelTargetPath = resolveBarrelExportFilePath(filePath, exportedName);
  const actualFilePath = barrelTargetPath ?? filePath;

  const programRoot = parseSourceFile(actualFilePath);
  if (!programRoot) return null;

  const exported = findExportedFunctionBody(programRoot, exportedName);
  if (exported) return exported;

  // The export might be a re-export not handled by the barrel
  // resolver. Probe each candidate re-export source in turn — a
  // matching named re-export is precise, otherwise every `export *`
  // is tried until one resolves.
  for (const reExportSource of findReExportSourcesForName(programRoot, exportedName)) {
    const nextFilePath = resolveRelativeImportPath(actualFilePath, reExportSource);
    if (!nextFilePath) continue;
    const resolved = resolveFunctionExportInFile(nextFilePath, exportedName, visitedFilePaths);
    if (resolved) return resolved;
  }

  return null;
};

// Resolves `import { name } from "source"` to the actual function
// body, following barrel re-exports up to CROSS_FILE_BARREL_FOLLOW_DEPTH
// levels.
const resolveCrossFileFunctionExport = (
  fromFilename: string,
  source: string,
  exportedName: string,
): EsTreeNode | null => {
  const resolvedFilePath = resolveRelativeImportPath(fromFilename, source);
  if (!resolvedFilePath) return null;
  return resolveFunctionExportInFile(resolvedFilePath, exportedName, new Set<string>());
};

// Resolves a reducer-argument expression to a function/arrow node we
// can analyse for mutations. Handles three cases:
//
//   1. Inline function / arrow / function-expression — returned directly.
//   2. Same-file Identifier binding — resolved via findVariableInitializer.
//   3. Cross-file imported reducer — follows the import source (with
//      barrel + re-export support) and locates the exported function.
//      The cross-file branch is gated on `currentFilename` because it
//      drives path resolution; tests that don't supply a filename
//      (`runRule` with no filename option) get the same behaviour as
//      v1 (skip cross-file).
export const resolveReducerFunction = (
  node: EsTreeNode | null | undefined,
  currentFilename: string | undefined,
): ResolvedReducer | null => {
  if (!node) return null;
  const unwrappedNode = stripParenExpression(node);
  if (isFunctionLike(unwrappedNode)) {
    return { functionNode: unwrappedNode, crossFileSourceDisplay: null };
  }
  if (!isNodeOfType(unwrappedNode, "Identifier")) return null;

  const binding = findVariableInitializer(unwrappedNode, unwrappedNode.name);
  const initializer = binding?.initializer;
  if (!initializer) return null;

  // Local binding to a function/arrow in this file.
  const unwrappedInitializer = stripParenExpression(initializer);
  if (isFunctionLike(unwrappedInitializer)) {
    return { functionNode: unwrappedInitializer, crossFileSourceDisplay: null };
  }

  // Imported binding — follow into the other file.
  if (
    isNodeOfType(initializer, "ImportSpecifier") ||
    isNodeOfType(initializer, "ImportDefaultSpecifier")
  ) {
    if (!currentFilename) return null;
    const importDeclaration = initializer.parent;
    if (!importDeclaration || !isNodeOfType(importDeclaration, "ImportDeclaration")) return null;
    const sourceValue = importDeclaration.source?.value;
    if (typeof sourceValue !== "string") return null;
    // Non-relative imports (`from "react-redux"`, etc.) resolve into
    // node_modules. We skip those — they're packaged code, not the
    // user's reducer.
    if (!sourceValue.startsWith(".") && !sourceValue.startsWith("/")) return null;

    const exportedName = resolveImportedExportName(initializer);
    if (!exportedName) return null;
    const crossFileFunction = resolveCrossFileFunctionExport(
      currentFilename,
      sourceValue,
      exportedName,
    );
    if (!crossFileFunction) return null;
    return {
      functionNode: crossFileFunction,
      // Use the import-source string the user wrote — that's what
      // they'll search for to find the mutation. Resolving to the
      // absolute on-disk path would be technically more precise but
      // less actionable in a diagnostic.
      crossFileSourceDisplay: sourceValue,
    };
  }

  return null;
};
