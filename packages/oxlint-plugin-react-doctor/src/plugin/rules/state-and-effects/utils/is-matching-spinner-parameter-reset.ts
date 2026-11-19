import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { getImportDeclarationForSymbol } from "../../../utils/get-import-declaration-for-symbol.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { isAstDescendant } from "../../../utils/is-ast-descendant.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isReactApiCall } from "../../../utils/is-react-api-call.js";
import { resolveReactUseStatePair } from "../../../utils/resolve-react-use-state-pair.js";
import { someAst } from "../../../utils/some-ast.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";

const getGuardedSetterTest = (
  guard: EsTreeNode | undefined,
  call: EsTreeNodeOfType<"CallExpression">,
  value: boolean,
): EsTreeNodeOfType<"Identifier"> | null => {
  if (!isNodeOfType(guard, "IfStatement") || guard.alternate || call.optional) return null;
  const consequent = guard.consequent;
  if (isNodeOfType(consequent, "BlockStatement") && consequent.body.length !== 1) return null;
  const statement = isNodeOfType(consequent, "BlockStatement") ? consequent.body[0] : consequent;
  if (
    !isNodeOfType(statement, "ExpressionStatement") ||
    stripParenExpression(statement.expression) !== call ||
    call.arguments.length !== 1
  )
    return null;
  const argument = stripParenExpression(call.arguments[0]);
  const test = stripParenExpression(guard.test);
  return isNodeOfType(argument, "Literal") &&
    argument.value === value &&
    isNodeOfType(test, "Identifier")
    ? test
    : null;
};

export const isMatchingSpinnerParameterReset = (
  raise: EsTreeNode,
  reset: EsTreeNode,
  protectingTry: EsTreeNodeOfType<"TryStatement">,
  callback: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    !isNodeOfType(callback.body, "BlockStatement") ||
    protectingTry.parent !== callback.body ||
    !isNodeOfType(raise, "CallExpression") ||
    !isNodeOfType(reset, "CallExpression") ||
    !isNodeOfType(raise.callee, "Identifier") ||
    !isNodeOfType(reset.callee, "Identifier")
  )
    return false;

  const tryIndex = callback.body.body.findIndex((statement) => statement === protectingTry);
  const raiseTest = getGuardedSetterTest(callback.body.body[tryIndex - 1], raise, true);
  const resetTest = getGuardedSetterTest(protectingTry.finalizer?.body[0], reset, false);
  if (!raiseTest || !resetTest) return false;

  const parameter = scopes.symbolFor(raiseTest);
  if (
    !parameter ||
    parameter.kind !== "parameter" ||
    scopes.symbolFor(resetTest) !== parameter ||
    !callback.params.some((formal) => formal === parameter.declarationNode) ||
    parameter.references.length !== 2 ||
    !parameter.references.every(
      ({ flag, identifier }) =>
        flag === "read" && (identifier === raiseTest || identifier === resetTest),
    ) ||
    !hasCompleteSymbolReferences(parameter, scopes.rootScope.node, scopes)
  )
    return false;
  const formal = parameter.declarationNode;
  if (
    formal !== parameter.bindingIdentifier &&
    (!isNodeOfType(formal, "AssignmentPattern") ||
      formal.left !== parameter.bindingIdentifier ||
      !isNodeOfType(formal.right, "Literal") ||
      formal.right.value !== false)
  )
    return false;

  const pair = resolveReactUseStatePair(raise.callee, scopes);
  const hook = pair?.declarator.init;
  if (
    !pair ||
    !isNodeOfType(hook, "CallExpression") ||
    hook.optional ||
    !isNodeOfType(hook.callee, "Identifier") ||
    !isReactApiCall(hook, "useState", scopes)
  )
    return false;
  const hookSymbol = scopes.symbolFor(hook.callee);
  const declaration = hookSymbol && getImportDeclarationForSymbol(hookSymbol);
  if (
    !hookSymbol ||
    !isNodeOfType(hookSymbol.declarationNode, "ImportSpecifier") ||
    hookSymbol.declarationNode.importKind === "type" ||
    !declaration ||
    declaration.importKind === "type" ||
    declaration.source.value !== "react"
  )
    return false;

  const { setterSymbol } = pair;
  const owner = findEnclosingFunction(pair.declarator);
  return Boolean(
    owner &&
    isAstDescendant(callback, owner) &&
    setterSymbol.kind === "const" &&
    scopes.symbolFor(raise.callee) === setterSymbol &&
    scopes.symbolFor(reset.callee) === setterSymbol &&
    setterSymbol.references.length === 2 &&
    setterSymbol.references.every(
      ({ flag, identifier }) =>
        flag === "read" && (identifier === raise.callee || identifier === reset.callee),
    ) &&
    hasCompleteSymbolReferences(setterSymbol, scopes.rootScope.node, scopes) &&
    !someAst(owner, (node) => isNodeOfType(node, "Identifier") && node.name === "eval"),
  );
};
