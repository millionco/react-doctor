import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { getValueImportSource } from "../../../utils/get-value-import-declaration.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";

const importedHookReferenceSafetyByAnalysis = new WeakMap<ScopeAnalysis, Map<number, boolean>>();

export const getNativeRefCleanupHookCall = (
  identifier: EsTreeNode,
  apiName: string,
  ownerBody: EsTreeNode,
  scopes: ScopeAnalysis,
): EsTreeNodeOfType<"CallExpression"> | null => {
  if (!isNodeOfType(identifier, "Identifier")) return null;
  const symbol = scopes.symbolFor(identifier);
  if (!symbol || symbol.references.some((reference) => reference.flag !== "read")) return null;
  const declaration = symbol.declarationNode;
  if (
    !isNodeOfType(declaration, "VariableDeclarator") ||
    !isNodeOfType(declaration.parent, "VariableDeclaration") ||
    declaration.parent.parent !== ownerBody
  ) {
    return null;
  }
  const initializer = getDirectConstInitializer(symbol);
  const call = initializer ? stripParenExpression(initializer) : null;
  if (!isNodeOfType(call, "CallExpression") || call.optional) return null;
  const callee = stripParenExpression(call.callee);
  if (!isNodeOfType(callee, "Identifier")) return null;
  const imported = scopes.symbolFor(callee);
  if (
    !imported ||
    getValueImportSource(imported) !== "react" ||
    getImportedName(imported.declarationNode) !== apiName
  ) {
    return null;
  }
  const referenceSafetyBySymbol =
    importedHookReferenceSafetyByAnalysis.get(scopes) ?? new Map<number, boolean>();
  importedHookReferenceSafetyByAnalysis.set(scopes, referenceSafetyBySymbol);
  let hasSafeReferences = referenceSafetyBySymbol.get(imported.id);
  if (hasSafeReferences === undefined) {
    hasSafeReferences = !imported.references.some((reference) => {
      const referenceRoot = findTransparentExpressionRoot(reference.identifier);
      const invocation = referenceRoot.parent;
      return (
        reference.flag !== "read" ||
        !isNodeOfType(invocation, "CallExpression") ||
        invocation.callee !== referenceRoot ||
        invocation.optional
      );
    });
    referenceSafetyBySymbol.set(imported.id, hasSafeReferences);
  }
  return hasSafeReferences ? call : null;
};
