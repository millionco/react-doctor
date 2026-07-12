import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isTypeOnlyImport } from "../../../utils/is-type-only-import.js";
import { resolveConstIdentifierAlias } from "../../../utils/resolve-const-identifier-alias.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import type { Rule } from "../../../utils/rule.js";

interface DeprecatedReactImportRuleOptions {
  /** The exact `import "..."` source string this rule watches. */
  source: string;
  /** Per-imported-name message dictionary. Exact-match lookup. */
  messages: ReadonlyMap<string, string>;
  /**
   * Optional extra ImportDeclaration handler invoked BEFORE the standard
   * source check — used by the react-dom rule to flag every import from
   * `react-dom/test-utils` (whole entry point gone in React 19).
   * Return `true` to mark "handled, skip the standard branch".
   */
  handleExtraSource?: (
    node: EsTreeNodeOfType<"ImportDeclaration">,
    context: RuleContext,
  ) => boolean;
}

// Returns only the `create` slot so the per-rule defineRule call owns the
// framework / severity / category / recommendation metadata — the factory
// shouldn't double-specify those (which would either silently win via spread
// order or trip a `specified more than once` typecheck error).
export const createDeprecatedReactImportRule = ({
  source,
  messages,
  handleExtraSource,
}: DeprecatedReactImportRuleOptions): Pick<Rule, "create"> => ({
  create: (context: RuleContext) => {
    const namespaceImportSpecifiers = new Set<EsTreeNode>();
    const resolvesToNamespaceImport = (identifier: EsTreeNode): boolean => {
      const symbol = resolveConstIdentifierAlias(identifier, context.scopes);
      return Boolean(symbol && namespaceImportSpecifiers.has(symbol.declarationNode));
    };

    return {
      ImportDeclaration(node: EsTreeNodeOfType<"ImportDeclaration">) {
        const sourceValue = node.source?.value;
        if (typeof sourceValue !== "string") return;
        if (handleExtraSource?.(node, context)) return;
        if (sourceValue !== source) return;
        // Type-only imports emit no runtime code — the deprecated API is
        // never actually called, so the runtime-migration hint is noise.
        if (isTypeOnlyImport(node)) return;

        for (const specifier of node.specifiers ?? []) {
          if (isNodeOfType(specifier, "ImportSpecifier")) {
            if (specifier.importKind === "type") continue;
            const importedName = getImportedName(specifier);
            if (!importedName) continue;
            const message = messages.get(importedName);
            if (message) context.report({ node: specifier, message });
            continue;
          }
          if (
            isNodeOfType(specifier, "ImportDefaultSpecifier") ||
            isNodeOfType(specifier, "ImportNamespaceSpecifier")
          ) {
            namespaceImportSpecifiers.add(specifier);
          }
        }
      },
      MemberExpression(node: EsTreeNodeOfType<"MemberExpression">) {
        if (namespaceImportSpecifiers.size === 0) return;
        if (node.computed) return;
        // `(React as any).createFactory` still calls the deprecated API —
        // strip transparent wrappers before matching the namespace binding.
        const receiver = stripParenExpression(node.object);
        if (!isNodeOfType(receiver, "Identifier")) return;
        if (!resolvesToNamespaceImport(receiver)) return;
        if (!isNodeOfType(node.property, "Identifier")) return;
        const message = messages.get(node.property.name);
        if (message) context.report({ node, message });
      },
    };
  },
});
