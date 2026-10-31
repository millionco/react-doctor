import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findGuardingTryStatement } from "./find-guarding-try-statement.js";
import { getImportedName } from "./get-imported-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isValueImportFromModule } from "./is-value-import-from-module.js";
import { stripParenExpression } from "./strip-paren-expression.js";

interface ImportedNextNavigationExitInput {
  statement: EsTreeNode;
  scopes: ScopeAnalysis;
}

const nextNavigationExitProofs = new WeakMap<ScopeAnalysis, WeakMap<EsTreeNode, boolean>>();

export const isImportedNextNavigationExit = ({
  statement,
  scopes,
}: ImportedNextNavigationExitInput): boolean => {
  let scopeProofs = nextNavigationExitProofs.get(scopes);
  if (!scopeProofs) {
    scopeProofs = new WeakMap<EsTreeNode, boolean>();
    nextNavigationExitProofs.set(scopes, scopeProofs);
  }
  const cachedProof = scopeProofs.get(statement);
  if (cachedProof !== undefined) return cachedProof;
  scopeProofs.set(statement, false);
  const lastStatement = isNodeOfType(statement, "BlockStatement")
    ? statement.body.at(-1)
    : statement;
  if (!lastStatement || !isNodeOfType(lastStatement, "ExpressionStatement")) return false;
  const expression = stripParenExpression(lastStatement.expression);
  if (!isNodeOfType(expression, "CallExpression") || expression.optional) return false;
  const callee = stripParenExpression(expression.callee);
  if (!isNodeOfType(callee, "Identifier")) return false;
  const symbol = scopes.symbolFor(callee);
  const importedName = symbol?.kind === "import" ? getImportedName(symbol.declarationNode) : null;
  const hasProvenExit = Boolean(
    symbol?.kind === "import" &&
    isValueImportFromModule(symbol, "next/navigation") &&
    (importedName === "notFound" ||
      importedName === "redirect" ||
      importedName === "permanentRedirect") &&
    symbol.references.every((reference) => reference.flag === "read") &&
    !findGuardingTryStatement(expression),
  );
  scopeProofs.set(statement, hasProvenExit);
  return hasProvenExit;
};
