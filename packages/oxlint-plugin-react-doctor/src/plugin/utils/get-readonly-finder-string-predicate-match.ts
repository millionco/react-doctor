import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

interface ReadonlyFinderStringPredicateMatch {
  aliasName: string;
  declaration: EsTreeNodeOfType<"VariableDeclaration">;
  receiver: EsTreeNodeOfType<"MemberExpression">;
  stringGuard: EsTreeNode;
}

export const getReadonlyFinderStringPredicateMatch = (
  matchCall: EsTreeNodeOfType<"CallExpression">,
  predicateFunction: EsTreeNode,
  scopes: ScopeAnalysis,
): ReadonlyFinderStringPredicateMatch | null => {
  if (
    !isNodeOfType(predicateFunction, "ArrowFunctionExpression") ||
    predicateFunction.async ||
    !isNodeOfType(predicateFunction.body, "BlockStatement")
  ) {
    return null;
  }
  const [parameter, ...additionalParameters] = predicateFunction.params;
  const [declaration, returnStatement, ...additionalStatements] = predicateFunction.body.body;
  if (
    !isNodeOfType(parameter, "Identifier") ||
    additionalParameters.length !== 0 ||
    !isNodeOfType(declaration, "VariableDeclaration") ||
    declaration.kind !== "const" ||
    !isNodeOfType(returnStatement, "ReturnStatement") ||
    !returnStatement.argument ||
    additionalStatements.length !== 0
  ) {
    return null;
  }
  const [declarator, ...additionalDeclarators] = declaration.declarations;
  if (
    !declarator ||
    additionalDeclarators.length !== 0 ||
    !isNodeOfType(declarator.id, "Identifier") ||
    !declarator.init
  ) {
    return null;
  }
  const receiver = stripParenExpression(declarator.init);
  const parameterSymbol = scopes.symbolFor(parameter);
  if (
    !isNodeOfType(receiver, "MemberExpression") ||
    receiver.computed ||
    receiver.optional ||
    !isNodeOfType(receiver.property, "Identifier") ||
    receiver.property.name !== "className" ||
    !isNodeOfType(receiver.object, "Identifier") ||
    !parameterSymbol ||
    scopes.symbolFor(receiver.object) !== parameterSymbol
  ) {
    return null;
  }
  const aliasSymbol = scopes.symbolFor(declarator.id);
  const matchCallee = stripParenExpression(matchCall.callee);
  const returnedExpression = stripParenExpression(returnStatement.argument);
  const [patternArgument, ...additionalArguments] = matchCall.arguments;
  if (
    aliasSymbol?.kind !== "const" ||
    aliasSymbol.bindingIdentifier !== declarator.id ||
    aliasSymbol.references.some((reference) => reference.flag !== "read") ||
    !isNodeOfType(matchCallee, "MemberExpression") ||
    matchCallee.computed ||
    matchCallee.optional ||
    matchCall.optional ||
    !patternArgument ||
    isNodeOfType(patternArgument, "SpreadElement") ||
    additionalArguments.length !== 0 ||
    !isNodeOfType(matchCallee.property, "Identifier") ||
    matchCallee.property.name !== "match" ||
    !isNodeOfType(matchCallee.object, "Identifier") ||
    scopes.symbolFor(matchCallee.object) !== aliasSymbol ||
    !isNodeOfType(returnedExpression, "LogicalExpression") ||
    returnedExpression.operator !== "&&"
  ) {
    return null;
  }
  const firstNegation = stripParenExpression(returnedExpression.right);
  if (!isNodeOfType(firstNegation, "UnaryExpression") || firstNegation.operator !== "!") {
    return null;
  }
  const secondNegation = stripParenExpression(firstNegation.argument);
  if (
    !isNodeOfType(secondNegation, "UnaryExpression") ||
    secondNegation.operator !== "!" ||
    stripParenExpression(secondNegation.argument) !== matchCall
  ) {
    return null;
  }
  return {
    aliasName: declarator.id.name,
    declaration,
    receiver,
    stringGuard: returnedExpression.left,
  };
};
