import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getImportBindingForName } from "./find-import-source-for-name.js";
import { getRequireCallSource } from "./get-require-call-source.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { resolveConstIdentifierAlias } from "./resolve-const-identifier-alias.js";
import { stripParenExpression } from "./strip-paren-expression.js";

const NODE_CRYPTO_MODULE_SOURCES = new Set(["crypto", "node:crypto"]);

export const isProvenNodeCryptoNamespaceReference = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const identifier = stripParenExpression(expression);
  if (!isNodeOfType(identifier, "Identifier")) return false;
  const symbol = resolveConstIdentifierAlias(identifier, scopes);
  if (!symbol) return false;
  if (symbol.kind === "import") {
    const importBinding = getImportBindingForName(identifier, symbol.name);
    return Boolean(importBinding && NODE_CRYPTO_MODULE_SOURCES.has(importBinding.source));
  }
  return Boolean(
    symbol.kind === "const" &&
    symbol.initializer &&
    NODE_CRYPTO_MODULE_SOURCES.has(getRequireCallSource(symbol.initializer) ?? ""),
  );
};
