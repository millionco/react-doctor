import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { FIRST_SPLIT_PART_INDEX } from "./constants.js";

export const hasClosedSplitAliasReferences = (
  symbol: SymbolDescriptor,
  access: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const owner = findEnclosingFunction(access);
  if (!owner || findEnclosingFunction(symbol.declarationNode) !== owner) return false;
  if (symbol.declarationNode.range[1] > access.range[0]) return false;
  let hasDynamicCodeReference = false;
  walkAst(owner, (node) => {
    if (hasDynamicCodeReference) return false;
    if (
      isNodeOfType(node, "Identifier") &&
      node.name === "eval" &&
      scopes.isGlobalReference(node)
    ) {
      hasDynamicCodeReference = true;
      return false;
    }
  });
  if (hasDynamicCodeReference) return false;
  return symbol.references.every((reference) => {
    if (reference.flag !== "read" || findEnclosingFunction(reference.identifier) !== owner) {
      return false;
    }
    const receiver = findTransparentExpressionRoot(reference.identifier);
    const member = receiver.parent;
    if (
      !member ||
      !isNodeOfType(member, "MemberExpression") ||
      member.object !== receiver ||
      !member.computed ||
      isWithinAssignmentTarget(member)
    ) {
      return false;
    }
    return (
      isNodeOfType(member.property, "Literal") &&
      typeof member.property.value === "number" &&
      Number.isInteger(member.property.value) &&
      member.property.value >= FIRST_SPLIT_PART_INDEX
    );
  });
};
