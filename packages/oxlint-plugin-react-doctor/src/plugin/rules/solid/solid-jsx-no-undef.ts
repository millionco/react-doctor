import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { ScopeDescriptor } from "../../semantic/scope-analysis.js";
import { isDomElementName } from "../../utils/is-dom-element-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

const isUndefinedIdentifier = (context: RuleContext, identifier: EsTreeNode): boolean =>
  context.scopes.symbolFor(identifier) === null && context.scopes.isGlobalReference(identifier);

const isNameUnresolvedInScope = (context: RuleContext, name: string, node: EsTreeNode): boolean => {
  let scope: ScopeDescriptor | null = context.scopes.scopeFor(node);
  while (scope) {
    if (scope.symbolsByName.has(name)) return false;
    scope = scope.parent;
  }
  return true;
};

const walkToRootJsxObject = (
  memberExpression: EsTreeNodeOfType<"JSXMemberExpression">,
): EsTreeNodeOfType<"JSXIdentifier"> | null => {
  let current: EsTreeNode = memberExpression;
  while (isNodeOfType(current, "JSXMemberExpression")) {
    current = current.object as EsTreeNode;
  }
  return isNodeOfType(current, "JSXIdentifier") ? current : null;
};

export const solidJsxNoUndef = defineRule<Rule>({
  id: "solid-jsx-no-undef",
  severity: "error",
  requires: ["solid"],
  recommendation: "Import or define all components and directives before referencing them in JSX.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (isNodeOfType(node.name, "JSXIdentifier")) {
        if (isDomElementName(node.name.name)) return;
        if (isUndefinedIdentifier(context, node.name as EsTreeNode)) {
          context.report({
            node: node.name as EsTreeNode,
            message: `'${node.name.name}' is not defined.`,
          });
        }
        return;
      }

      if (isNodeOfType(node.name, "JSXMemberExpression")) {
        const rootIdentifier = walkToRootJsxObject(node.name);
        if (rootIdentifier && isUndefinedIdentifier(context, rootIdentifier as EsTreeNode)) {
          context.report({
            node: rootIdentifier as EsTreeNode,
            message: `'${rootIdentifier.name}' is not defined.`,
          });
        }
      }
    },

    JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
      if (!isNodeOfType(node.name, "JSXNamespacedName")) return;
      const namespacedName = node.name;
      if (!isNodeOfType(namespacedName.namespace, "JSXIdentifier")) return;
      if (namespacedName.namespace.name !== "use") return;
      if (!isNodeOfType(namespacedName.name, "JSXIdentifier")) return;

      const directiveIdentifier = namespacedName.name;
      if (
        isNameUnresolvedInScope(
          context,
          directiveIdentifier.name,
          directiveIdentifier as EsTreeNode,
        )
      ) {
        context.report({
          node: directiveIdentifier as EsTreeNode,
          message: `Custom directive '${directiveIdentifier.name}' is not defined.`,
        });
      }
    },
  }),
});
