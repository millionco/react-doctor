import { defineRule } from "../../utils/define-rule.js";
import { getRootIdentifierName } from "../../utils/get-root-identifier-name.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const DERIVING_ARRAY_METHODS = new Set(["toSorted", "toReversed", "filter", "map", "slice"]);

const getDerivingMethodName = (node: EsTreeNode): string | null => {
  if (!isNodeOfType(node, "CallExpression")) return null;
  if (!isNodeOfType(node.callee, "MemberExpression")) return null;
  if (!isNodeOfType(node.callee.property, "Identifier")) return null;
  return node.callee.property.name;
};

// HACK: passing both `<Client list={items} sortedList={items.toSorted()} />`
// (or any pair of derivations of the same source) doubles the bytes
// React serializes across the RSC wire. The client gets two copies of
// roughly the same array; one of the props is redundant. Have the
// client derive what it needs from the single source prop instead.
export const serverDedupProps = defineRule<Rule>({
  framework: "global",
  severity: "warn",
  category: "Server",
  recommendation:
    "Pass the source array once and derive the projection on the client — passing both doubles RSC serialization bytes",
  examples: [
    {
      before: "<ClientList items={items} itemNames={items.map((i) => i.name)} />",
      after: "<ClientList items={items} />",
    },
  ],
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      const identifierAttributes: Map<string, string> = new Map();
      const derivedAttributes: Array<{ propName: string; rootName: string; node: EsTreeNode }> = [];

      for (const attr of node.attributes ?? []) {
        if (!isNodeOfType(attr, "JSXAttribute")) continue;
        if (!isNodeOfType(attr.name, "JSXIdentifier")) continue;
        if (!isNodeOfType(attr.value, "JSXExpressionContainer")) continue;
        const expression = attr.value.expression;
        if (!expression) continue;

        if (isNodeOfType(expression, "Identifier")) {
          identifierAttributes.set(expression.name, attr.name.name);
        } else if (isNodeOfType(expression, "CallExpression")) {
          const derivingMethod = getDerivingMethodName(expression);
          if (!derivingMethod || !DERIVING_ARRAY_METHODS.has(derivingMethod)) continue;
          const root = getRootIdentifierName(expression, { followCallChains: true });
          if (!root) continue;
          derivedAttributes.push({ propName: attr.name.name, rootName: root, node: attr });
        }
      }

      for (const derived of derivedAttributes) {
        const sourcePropName = identifierAttributes.get(derived.rootName);
        if (sourcePropName) {
          context.report({
            node: derived.node,
            message: `"${derived.propName}" is derived from "${sourcePropName}" (same source: ${derived.rootName}) — passing both doubles RSC serialization. Pass the source once and derive on the client`,
          });
        }
      }
    },
  }),
});
