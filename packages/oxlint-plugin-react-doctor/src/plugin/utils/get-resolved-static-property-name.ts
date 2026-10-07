import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { getStaticTemplateLiteralValue } from "./get-static-template-literal-value.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { resolveConstIdentifierAlias } from "./resolve-const-identifier-alias.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export interface ResolvedStaticPropertyNameOptions {
  allowConstNumericLiteral?: boolean;
  allowConstTemplateLiteral?: boolean;
  stringifyNonStringLiterals?: boolean;
}

export const getResolvedStaticPropertyName = (
  node: EsTreeNode,
  scopes: ScopeAnalysis,
  options: ResolvedStaticPropertyNameOptions = {},
): string | null => {
  const directPropertyName = getStaticPropertyKeyName(node, {
    allowComputedString: true,
    stringifyNonStringLiterals: options.stringifyNonStringLiterals,
  });
  if (
    directPropertyName !== null ||
    (!isNodeOfType(node, "Property") &&
      !isNodeOfType(node, "MethodDefinition") &&
      !isNodeOfType(node, "PropertyDefinition") &&
      !isNodeOfType(node, "MemberExpression")) ||
    !node.computed
  ) {
    return directPropertyName;
  }

  const key = isNodeOfType(node, "MemberExpression") ? node.property : node.key;
  const unwrappedKey = stripParenExpression(key);
  if (!isNodeOfType(unwrappedKey, "Identifier")) return null;
  const symbol = resolveConstIdentifierAlias(unwrappedKey, scopes);
  if (symbol?.kind !== "const" || !symbol.initializer) return null;
  const initializer = stripParenExpression(symbol.initializer);
  if (isNodeOfType(initializer, "Literal")) {
    if (typeof initializer.value === "string") return initializer.value;
    if (options.allowConstNumericLiteral && typeof initializer.value === "number") {
      return String(initializer.value);
    }
    return null;
  }
  return options.allowConstTemplateLiteral && isNodeOfType(initializer, "TemplateLiteral")
    ? getStaticTemplateLiteralValue(initializer)
    : null;
};
