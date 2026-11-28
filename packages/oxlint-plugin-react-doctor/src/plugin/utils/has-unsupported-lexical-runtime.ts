import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import { isKeyedDraftTypeReference } from "./is-keyed-draft-type-reference.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

const lexicalHazardsByAnalysis = new WeakMap<ScopeAnalysis, boolean>();

export const hasUnsupportedLexicalRuntime = (scopes: ScopeAnalysis): boolean => {
  const cached = lexicalHazardsByAnalysis.get(scopes);
  if (cached !== undefined) return cached;
  let hazardous = false;
  walkAst(scopes.rootScope.node, (node) => {
    if (hazardous || isKeyedDraftTypeReference(node)) return false;
    if (isNodeOfType(node, "WithStatement")) hazardous = true;
    if (isNodeOfType(node, "CallExpression")) {
      const callee = stripParenExpression(node.callee);
      if (isNodeOfType(callee, "Identifier") && callee.name === "eval") hazardous = true;
    }
  });
  lexicalHazardsByAnalysis.set(scopes, hazardous);
  return hazardous;
};
