import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { walkAst } from "./walk-ast.js";

const FUNCTION_RETURN_STATEMENTS_CACHE = new WeakMap<
  ScopeAnalysis,
  WeakMap<EsTreeNode, ReadonlyArray<EsTreeNodeOfType<"ReturnStatement">>>
>();

export const collectFunctionReturnStatements = (
  functionNode: EsTreeNode,
  scopes?: ScopeAnalysis,
): EsTreeNodeOfType<"ReturnStatement">[] => {
  const cachedReturnStatements = scopes
    ? FUNCTION_RETURN_STATEMENTS_CACHE.get(scopes)?.get(functionNode)
    : undefined;
  if (cachedReturnStatements) return [...cachedReturnStatements];
  if (!isFunctionLike(functionNode) || !isNodeOfType(functionNode.body, "BlockStatement"))
    return [];
  const returnStatements: EsTreeNodeOfType<"ReturnStatement">[] = [];
  walkAst(functionNode.body, (node) => {
    if (
      node !== functionNode.body &&
      (isFunctionLike(node) ||
        isNodeOfType(node, "ClassDeclaration") ||
        isNodeOfType(node, "ClassExpression"))
    ) {
      return false;
    }
    if (isNodeOfType(node, "ReturnStatement")) returnStatements.push(node);
  });
  if (scopes) {
    let scopeReturnStatements = FUNCTION_RETURN_STATEMENTS_CACHE.get(scopes);
    if (!scopeReturnStatements) {
      scopeReturnStatements = new WeakMap();
      FUNCTION_RETURN_STATEMENTS_CACHE.set(scopes, scopeReturnStatements);
    }
    scopeReturnStatements.set(functionNode, [...returnStatements]);
  }
  return returnStatements;
};
