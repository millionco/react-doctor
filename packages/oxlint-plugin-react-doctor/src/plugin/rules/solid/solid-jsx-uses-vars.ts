import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isDomElementName } from "../../utils/is-dom-element-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

// Port of `solid/jsx-uses-vars`. The upstream rule calls
// `markVariableAsUsed` as a side-effect to prevent ESLint's
// `no-unused-vars` from flagging JSX-referenced variables.
//
// Our scope analysis already tracks JSX component references
// natively (uppercase `<Component />` and `<obj.Foo />` root
// identifiers create binding references). However, Solid custom
// directives (`use:directiveName`) reference a variable that our
// scope analyzer intentionally skips (JSXNamespacedName parts are
// syntax fragments, not binding lookups).
//
// This rule fills that gap: it reports when a `use:X` directive
// references a variable that is defined but has zero other
// references — meaning the variable would appear "unused" to any
// unused-variable checker. It also reports when the directive
// variable is completely undefined (complements jsx-no-undef's
// directive check with a usage-tracking perspective).

const getDirectiveIdentifierName = (node: EsTreeNodeOfType<"JSXAttribute">): string | null => {
  if (!isNodeOfType(node.name, "JSXNamespacedName")) return null;
  const namespace = node.name.namespace;
  if (!isNodeOfType(namespace, "JSXIdentifier") || namespace.name !== "use") return null;
  const directiveName = node.name.name;
  if (!isNodeOfType(directiveName, "JSXIdentifier")) return null;
  return directiveName.name;
};

export const solidJsxUsesVars = defineRule<Rule>({
  id: "solid-jsx-uses-vars",
  severity: "warn",
  requires: ["solid"],
  defaultEnabled: false,
  recommendation:
    "Variables referenced by Solid's `use:directive` syntax are used at runtime — ensure your unused-variable tooling does not flag them.",
  create: (context: RuleContext) => {
    const directiveReferences = new Map<string, EsTreeNode[]>();

    return {
      JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
        const directiveName = getDirectiveIdentifierName(node);
        if (!directiveName) return;
        const existing = directiveReferences.get(directiveName) ?? [];
        existing.push(node.name as EsTreeNode);
        directiveReferences.set(directiveName, existing);
      },
      "Program:exit"(programNode: EsTreeNode) {
        if (!context.scopes) return;
        for (const [directiveName, references] of directiveReferences) {
          const scope = context.scopes.scopeFor(programNode);
          let currentScope: typeof scope | null = scope;
          let foundSymbol = false;
          while (currentScope) {
            const symbol = currentScope.symbolsByName.get(directiveName);
            if (symbol) {
              foundSymbol = true;
              const hasNonDirectiveReference = symbol.references.length > 0;
              if (!hasNonDirectiveReference) {
                context.report({
                  node: references[0],
                  message: `The variable \`${directiveName}\` is only used as a \`use:\` directive — ensure it is not flagged as unused by your linter.`,
                });
              }
              break;
            }
            currentScope = currentScope.parent;
          }
          if (!foundSymbol) {
            for (const reference of references) {
              context.report({
                node: reference,
                message: `The directive variable \`${directiveName}\` is not defined. Import or declare it before using \`use:${directiveName}\`.`,
              });
            }
          }
        }
      },
    };
  },
});
