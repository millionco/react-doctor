import { STATE_PAIR_SIZE, STATE_SETTER_INDEX } from "../constants/native-state-setter.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { collectFunctionReturnStatements } from "./collect-function-return-statements.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { getEquivalentSymbols } from "./get-equivalent-symbols.js";
import { getFunctionBindingSymbols } from "./get-function-binding-symbols.js";
import { isBindingAssignmentTarget } from "./is-binding-assignment-target.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { resolveConstIdentifierRootSymbol } from "./resolve-const-identifier-root-symbol.js";
import { walkAst } from "./walk-ast.js";

export const resolveReturnedNativeStateSetter = (
  functionNode: EsTreeNode,
  scopes: ScopeAnalysis,
  isNativeStateCall: (node: EsTreeNode) => boolean,
): EsTreeNode | null => {
  if (
    !isFunctionLike(functionNode) ||
    functionNode.async ||
    functionNode.generator ||
    functionNode.params.some((parameter) => !isNodeOfType(parameter, "Identifier")) ||
    !isNodeOfType(functionNode.body, "BlockStatement") ||
    functionNode.body.body.some(
      (statement) =>
        !isNodeOfType(statement, "VariableDeclaration") &&
        !isNodeOfType(statement, "ExpressionStatement") &&
        !isNodeOfType(statement, "ReturnStatement"),
    ) ||
    getFunctionBindingSymbols(functionNode, scopes).some((binding) =>
      binding.references.some(
        (reference) => reference.flag !== "read" || isBindingAssignmentTarget(reference.identifier),
      ),
    )
  ) {
    return null;
  }
  const returns = collectFunctionReturnStatements(functionNode);
  const returnStatement = returns[0];
  if (
    returns.length !== 1 ||
    functionNode.body.body.at(-1) !== returnStatement ||
    !isNodeOfType(returnStatement.argument, "ArrayExpression") ||
    returnStatement.argument.elements.length !== STATE_PAIR_SIZE ||
    !isNodeOfType(returnStatement.argument.elements[STATE_SETTER_INDEX], "Identifier")
  ) {
    return null;
  }
  const setter = returnStatement.argument.elements[STATE_SETTER_INDEX];
  const rootSymbol = resolveConstIdentifierRootSymbol(setter, scopes);
  const declaration = rootSymbol?.declarationNode;
  if (
    rootSymbol?.kind !== "const" ||
    rootSymbol.references.some(
      (reference) => reference.flag !== "read" || isBindingAssignmentTarget(reference.identifier),
    ) ||
    !isNodeOfType(declaration, "VariableDeclarator") ||
    !isNodeOfType(declaration.id, "ArrayPattern") ||
    declaration.id.elements[STATE_SETTER_INDEX] !== rootSymbol.bindingIdentifier ||
    declaration.parent?.parent !== functionNode.body ||
    !isNodeOfType(declaration.init, "CallExpression") ||
    findEnclosingFunction(declaration.init) !== functionNode ||
    !isNativeStateCall(declaration.init) ||
    getEquivalentSymbols(setter, scopes, true).length === 0 ||
    getEquivalentSymbols(setter, scopes, true).some((alias) =>
      alias.references.some(
        (reference) => reference.flag !== "read" || isBindingAssignmentTarget(reference.identifier),
      ),
    )
  ) {
    return null;
  }
  let hasOpaqueAccess = false;
  walkAst(functionNode, (node) => {
    if (
      isNodeOfType(node, "Identifier") &&
      (node.name === "arguments" || (node.name === "eval" && scopes.isGlobalReference(node)))
    ) {
      hasOpaqueAccess = true;
      return false;
    }
  });
  return hasOpaqueAccess ? null : declaration.init;
};
