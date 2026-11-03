import type { EsTreeNode } from "./es-tree-node.js";
import type { RuleContext } from "./rule-context.js";
import { getEquivalentSymbols } from "./get-equivalent-symbols.js";
import { getImportedName } from "./get-imported-name.js";
import { getValueImportDeclaration } from "./get-value-import-declaration.js";
import { hasStableReadonlyMatcherReferences } from "./has-stable-readonly-matcher-references.js";
import { hasStableReactNamespaceProviders } from "./has-stable-react-namespace-providers.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isReactApiCall } from "./is-react-api-call.js";
import { resolveConstIdentifierAlias } from "./resolve-const-identifier-alias.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export const getStableReactClassConsumerName = (
  node: EsTreeNode,
  context: RuleContext,
): "createElement" | "memo" | null => {
  if (
    !isNodeOfType(node, "CallExpression") ||
    node.optional ||
    !hasStableReactNamespaceProviders(context)
  )
    return null;
  for (const name of ["createElement", "memo"]) {
    if (
      !isReactApiCall(node, name, context.scopes, {
        allowGlobalReactNamespace: false,
        allowUnboundBareCalls: false,
        resolveNamedAliases: true,
      })
    )
      continue;
    const callee = stripParenExpression(node.callee);
    if (isNodeOfType(callee, "Identifier")) {
      const aliases = getEquivalentSymbols(callee, context.scopes);
      const imported = resolveConstIdentifierAlias(callee, context.scopes);
      const declaration = imported ? getValueImportDeclaration(imported) : null;
      if (
        !imported ||
        imported.kind !== "import" ||
        !isNodeOfType(declaration, "ImportDeclaration") ||
        declaration.source.value !== "react" ||
        getImportedName(imported.declarationNode) !== name ||
        !aliases.length ||
        aliases.some((alias) => !hasStableReadonlyMatcherReferences(alias, context))
      )
        return null;
    } else if (
      !isNodeOfType(callee, "MemberExpression") ||
      callee.optional ||
      callee.computed ||
      !isNodeOfType(stripParenExpression(callee.object), "Identifier")
    )
      return null;
    return name === "createElement" ? "createElement" : "memo";
  }
  return null;
};
