import { getImportedName } from "../../../utils/get-imported-name.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import type { Rule } from "../../../utils/rule.js";
import type { DeprecatedReactImportRuleOptions } from "./deprecated-react-import-rule-options.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";

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
    const namespaceBindings = new Set<string>();

    return {
      ImportDeclaration(node: EsTreeNodeOfType<"ImportDeclaration">) {
        const sourceValue = node.source?.value;
        if (typeof sourceValue !== "string") return;
        if (handleExtraSource?.(node, context)) return;
        if (sourceValue !== source) return;

        for (const specifier of node.specifiers ?? []) {
          if (isNodeOfType(specifier, "ImportSpecifier")) {
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
            const localName = specifier.local?.name;
            if (localName) namespaceBindings.add(localName);
          }
        }
      },
      MemberExpression(node: EsTreeNodeOfType<"MemberExpression">) {
        if (namespaceBindings.size === 0) return;
        if (node.computed) return;
        if (!isNodeOfType(node.object, "Identifier")) return;
        if (!namespaceBindings.has(node.object.name)) return;
        if (!isNodeOfType(node.property, "Identifier")) return;
        const message = messages.get(node.property.name);
        if (message) context.report({ node, message });
      },
    };
  },
});
