import { STATE_SETTER_INDEX } from "../constants/native-state-setter.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getEquivalentSymbols } from "./get-equivalent-symbols.js";
import { isBindingAssignmentTarget } from "./is-binding-assignment-target.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isProvenRcUtilControlledStateCall } from "./is-proven-rc-util-controlled-state-call.js";
import { resolveConstIdentifierRootSymbol } from "./resolve-const-identifier-root-symbol.js";

export const isImportedControlledStateSetter = (
  identifier: EsTreeNode,
  scopes: ScopeAnalysis,
  filename: string | undefined,
): boolean => {
  const rootSymbol = resolveConstIdentifierRootSymbol(identifier, scopes);
  const declaration = rootSymbol?.declarationNode;
  if (
    rootSymbol?.kind !== "const" ||
    rootSymbol.references.some(
      (reference) => reference.flag !== "read" || isBindingAssignmentTarget(reference.identifier),
    ) ||
    !isNodeOfType(declaration, "VariableDeclarator") ||
    !isNodeOfType(declaration.id, "ArrayPattern") ||
    declaration.id.elements[STATE_SETTER_INDEX] !== rootSymbol.bindingIdentifier ||
    !isNodeOfType(declaration.init, "CallExpression") ||
    getEquivalentSymbols(identifier, scopes, true).length === 0 ||
    getEquivalentSymbols(identifier, scopes, true).some((alias) =>
      alias.references.some(
        (reference) => reference.flag !== "read" || isBindingAssignmentTarget(reference.identifier),
      ),
    )
  ) {
    return false;
  }
  return isProvenRcUtilControlledStateCall(declaration.init, scopes, filename);
};
