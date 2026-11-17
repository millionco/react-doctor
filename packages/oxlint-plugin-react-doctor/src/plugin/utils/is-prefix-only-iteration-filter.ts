import { ARRAY_ITERATION_CALLBACK_ARGUMENT_COUNT } from "../constants/js.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getSingleReturnExpression } from "./get-single-return-expression.js";
import { createMethodMutationAnalysis } from "./has-proven-method-mutation.js";
import type { MethodMutationAnalysis } from "./has-proven-method-mutation.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isSymbolReadOnly } from "./is-symbol-read-only.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { stripThisParameter } from "./strip-this-parameter.js";
import type { RuleContext } from "./rule-context.js";
import { walkAst } from "./walk-ast.js";

const mutationAnalysisByScopes = new WeakMap<ScopeAnalysis, MethodMutationAnalysis>();

export const isPrefixOnlyIterationFilter = (
  callback: EsTreeNode,
  context: RuleContext,
): boolean => {
  const { scopes } = context;
  if (!isFunctionLike(callback)) return false;
  const parameters = stripThisParameter(callback.params);
  if (parameters.length !== ARRAY_ITERATION_CALLBACK_ARGUMENT_COUNT) return false;
  const symbols = parameters.map((parameter) => {
    if (!isNodeOfType(parameter, "Identifier")) return null;
    const symbol = scopes.symbolFor(parameter);
    return symbol?.bindingIdentifier === parameter && isSymbolReadOnly(symbol) ? symbol : null;
  });
  const [valueSymbol, indexSymbol, arraySymbol] = symbols;
  if (
    !valueSymbol ||
    !indexSymbol ||
    !arraySymbol ||
    new Set(symbols).size !== ARRAY_ITERATION_CALLBACK_ARGUMENT_COUNT
  )
    return false;
  const returned = getSingleReturnExpression(callback);
  if (!returned) return false;
  const comparison = stripParenExpression(returned);
  if (!isNodeOfType(comparison, "BinaryExpression") || comparison.operator !== "===") return false;
  const indexReference = stripParenExpression(comparison.right);
  const lookup = stripParenExpression(comparison.left);
  if (
    !isNodeOfType(indexReference, "Identifier") ||
    scopes.symbolFor(indexReference) !== indexSymbol ||
    !isNodeOfType(lookup, "CallExpression") ||
    lookup.optional ||
    lookup.arguments.length !== 1
  )
    return false;
  const callee = stripParenExpression(lookup.callee);
  if (
    !isNodeOfType(callee, "MemberExpression") ||
    callee.optional ||
    callee.computed ||
    !isNodeOfType(callee.property, "Identifier") ||
    callee.property.name !== "indexOf"
  )
    return false;
  const arrayReference = stripParenExpression(callee.object);
  const valueReference = stripParenExpression(lookup.arguments[0]);
  if (
    !(
      isNodeOfType(arrayReference, "Identifier") &&
      scopes.symbolFor(arrayReference) === arraySymbol &&
      isNodeOfType(valueReference, "Identifier") &&
      scopes.symbolFor(valueReference) === valueSymbol
    )
  )
    return false;
  const invocation = findTransparentExpressionRoot(callback).parent;
  if (!isNodeOfType(invocation, "CallExpression")) return false;
  let mutations = mutationAnalysisByScopes.get(scopes);
  if (!mutations) {
    mutations = createMethodMutationAnalysis(context);
    walkAst(scopes.rootScope.node, mutations.record);
    mutationAnalysisByScopes.set(scopes, mutations);
  }
  return !mutations.hasProvenMutation(arrayReference, "indexOf", invocation, ["Array"]);
};
