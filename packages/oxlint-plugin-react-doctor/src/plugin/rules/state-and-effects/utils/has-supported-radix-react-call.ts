import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findProgramRoot } from "../../../utils/find-program-root.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { getValueImportSource } from "../../../utils/get-value-import-declaration.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isProvenUnmodifiedReactApiCall } from "../../../utils/is-proven-unmodified-react-api-call.js";

export const hasSupportedRadixReactCall = (
  call: EsTreeNode,
  name: string,
  scopes: ScopeAnalysis,
): boolean => {
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    !isNodeOfType(call.callee, "Identifier")
  )
    return false;
  const symbol = scopes.symbolFor(call.callee);
  const program = findProgramRoot(call);
  return Boolean(
    symbol &&
    program &&
    getValueImportSource(symbol) === "react" &&
    isNodeOfType(symbol.declarationNode, "ImportSpecifier") &&
    getImportedName(symbol.declarationNode) === name &&
    hasCompleteSymbolReferences(symbol, program, scopes) &&
    isProvenUnmodifiedReactApiCall(call, name, scopes),
  );
};
