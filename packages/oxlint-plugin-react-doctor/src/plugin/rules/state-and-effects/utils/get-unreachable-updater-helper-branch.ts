import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { isAstDescendant } from "../../../utils/is-ast-descendant.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";

const hasDynamicScope = (owner: EsTreeNode): boolean => {
  let foundDynamicScope = false;
  walkAst(owner, (node) => {
    if (foundDynamicScope) return false;
    if (isNodeOfType(node, "WithStatement")) {
      foundDynamicScope = true;
    } else if (isNodeOfType(node, "CallExpression")) {
      const callee = stripParenExpression(node.callee);
      foundDynamicScope = isNodeOfType(callee, "Identifier") && callee.name === "eval";
    }
  });
  return foundDynamicScope;
};

export const getUnreachableUpdaterHelperBranch = (
  helper: EsTreeNode,
  updater: EsTreeNode,
  scopes: ScopeAnalysis,
): EsTreeNode | null => {
  if (
    helper === updater ||
    !isNodeOfType(helper, "ArrowFunctionExpression") ||
    helper.async ||
    helper.params.length !== 0 ||
    !isNodeOfType(helper.body, "BlockStatement")
  ) {
    return null;
  }

  const declaration = helper.parent;
  const owner = findEnclosingFunction(helper);
  const firstStatement = helper.body.body[0];
  if (
    !owner ||
    !isAstDescendant(updater, owner) ||
    !isNodeOfType(declaration, "VariableDeclarator") ||
    !isNodeOfType(declaration.id, "Identifier") ||
    !isNodeOfType(firstStatement, "IfStatement")
  ) {
    return null;
  }
  const helperSymbol = scopes.symbolFor(declaration.id);
  if (
    !helperSymbol ||
    getDirectConstInitializer(helperSymbol) !== helper ||
    helperSymbol.references.length !== 1
  ) {
    return null;
  }

  const [reference] = helperSymbol.references;
  const call = reference.identifier.parent;
  if (
    reference.flag !== "read" ||
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    call.callee !== reference.identifier ||
    call.arguments.length !== 0 ||
    findEnclosingFunction(call) !== updater
  ) {
    return null;
  }
  const statement = call.parent;
  if (!isNodeOfType(statement, "ExpressionStatement") || statement.expression !== call) return null;
  const parent = statement.parent;
  const block = isNodeOfType(parent, "BlockStatement") ? parent : null;
  if (block && block.body[0] !== statement) return null;
  const guard = block ? block.parent : parent;
  if (!isNodeOfType(guard, "IfStatement") || guard.consequent !== (block ?? statement)) return null;

  const callerTest = stripParenExpression(guard.test);
  const helperTest = stripParenExpression(firstStatement.test);
  if (
    !isNodeOfType(callerTest, "Identifier") ||
    !isNodeOfType(helperTest, "UnaryExpression") ||
    helperTest.operator !== "!"
  )
    return null;
  const opposite = stripParenExpression(helperTest.argument);
  if (!isNodeOfType(opposite, "Identifier")) return null;

  const binding = scopes.symbolFor(callerTest);
  return binding &&
    scopes.symbolFor(opposite) === binding &&
    getDirectConstInitializer(binding) &&
    findEnclosingFunction(binding.bindingIdentifier) === owner &&
    hasCompleteSymbolReferences(helperSymbol, scopes.rootScope.node, scopes) &&
    !hasDynamicScope(owner)
    ? firstStatement.consequent
    : null;
};
