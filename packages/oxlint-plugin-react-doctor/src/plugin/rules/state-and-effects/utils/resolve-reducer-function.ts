import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { resolveImportedExportName } from "../../../utils/find-exported-function-body.js";
import { findVariableInitializer } from "../../../utils/find-variable-initializer.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { resolveCrossFileFunctionExport } from "../../../utils/resolve-cross-file-function-export.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";

export interface ResolvedReducer {
  readonly functionNode: EsTreeNode;
  // When non-null, the reducer body comes from a different file. The
  // display path (relative when possible, else absolute) is woven
  // into the diagnostic message.
  readonly crossFileSourceDisplay: string | null;
}

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

    const exportedName = resolveImportedExportName(initializer);
    if (!exportedName) return null;
    // Relative, absolute, AND tsconfig-alias (`@/…`) imports are followed.
    // `resolveCrossFileFunctionExport` resolves the source via
    // resolveModulePath, which returns null for bare node-module
    // specifiers that match no alias (`react-redux`, etc.), so packaged
    // code is skipped without an explicit guard here.
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
