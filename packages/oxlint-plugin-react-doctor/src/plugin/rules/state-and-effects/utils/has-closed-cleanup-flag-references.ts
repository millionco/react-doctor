import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { isAstDescendant } from "../../../utils/is-ast-descendant.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";

export const hasClosedCleanupFlagReferences = (
  symbol: SymbolDescriptor,
  callback: EsTreeNode,
  setupFunctions: readonly EsTreeNode[],
  listener: EsTreeNode,
  cleanup: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const program = scopes.rootScope.node;
  const initializer = symbol.initializer && stripParenExpression(symbol.initializer);
  if (
    symbol.kind !== "let" ||
    !isNodeOfType(initializer, "Literal") ||
    typeof initializer.value !== "boolean" ||
    !hasCompleteSymbolReferences(symbol, program, scopes)
  )
    return false;
  let declaration: EsTreeNode | null | undefined = symbol.declarationNode;
  while (declaration && declaration !== program) {
    if (
      isNodeOfType(declaration, "ExportNamedDeclaration") ||
      isNodeOfType(declaration, "ExportDefaultDeclaration")
    )
      return false;
    declaration = declaration.parent;
  }
  const owners = [callback, ...setupFunctions];
  for (const reference of symbol.references) {
    const identifier = reference.identifier;
    if (identifier === symbol.bindingIdentifier) continue;
    if (isAstDescendant(identifier, listener)) return false;
    const inCleanup = isAstDescendant(identifier, cleanup);
    if (!inCleanup && !owners.some((owner) => isAstDescendant(identifier, owner))) return false;
    const referenceRoot = findTransparentExpressionRoot(identifier);
    const consumer = referenceRoot.parent;
    const allowedOwners = inCleanup ? [cleanup] : owners;
    let owner = findEnclosingFunction(identifier);
    while (owner && !allowedOwners.includes(owner)) {
      const invocation = findTransparentExpressionRoot(owner).parent;
      if (
        !isNodeOfType(invocation, "CallExpression") ||
        invocation.optional ||
        stripParenExpression(invocation.callee) !== owner ||
        invocation.arguments.length !== 0
      )
        return false;
      owner = findEnclosingFunction(invocation);
    }
    if (!owner) return false;
    if (isWithinAssignmentTarget(identifier)) {
      if (
        !isNodeOfType(consumer, "AssignmentExpression") ||
        consumer.operator !== "=" ||
        consumer.left !== referenceRoot ||
        !isNodeOfType(consumer.right, "Literal") ||
        typeof consumer.right.value !== "boolean" ||
        !isNodeOfType(findTransparentExpressionRoot(consumer).parent, "ExpressionStatement")
      )
        return false;
      continue;
    }
    if (inCleanup || reference.flag !== "read") return false;
    let guard = referenceRoot;
    while (isNodeOfType(guard.parent, "UnaryExpression") && guard.parent.operator === "!")
      guard = findTransparentExpressionRoot(guard.parent);
    const parent = guard.parent;
    if (
      !(
        (isNodeOfType(parent, "IfStatement") ||
          isNodeOfType(parent, "WhileStatement") ||
          isNodeOfType(parent, "DoWhileStatement") ||
          isNodeOfType(parent, "ForStatement")) &&
        parent.test === guard
      )
    )
      return false;
  }
  return true;
};
