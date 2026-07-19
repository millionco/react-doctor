import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getRootIdentifier } from "./get-root-identifier.js";
import { resolveConstIdentifierAlias } from "./resolve-const-identifier-alias.js";
import { resolveExactLocalFunction } from "./resolve-exact-local-function.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export const isImportedOrStableParameterCall = (
  node: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
): boolean => {
  const callee = stripParenExpression(node.callee);
  if (resolveExactLocalFunction(callee, scopes)) return false;
  const rootIdentifier = getRootIdentifier(callee);
  if (!rootIdentifier || scopes.isGlobalReference(rootIdentifier)) return false;
  const symbol = resolveConstIdentifierAlias(rootIdentifier, scopes);
  return Boolean(
    symbol &&
    (symbol.kind === "import" ||
      (symbol.kind === "parameter" &&
        symbol.references.every((reference) => reference.flag === "read"))),
  );
};
