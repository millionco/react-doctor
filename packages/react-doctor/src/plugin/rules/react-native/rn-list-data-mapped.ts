import { defineRule } from "../../utils/define-rule.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { resolveJsxElementName } from "./utils/resolve-jsx-element-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// Short-name form: resolveJsxElementName drops the `Animated.` prefix,
// so `<Animated.FlatList>` resolves to `"FlatList"` and matches here.
const VIRTUALIZED_LIST_NAMES = new Set([
  "FlatList",
  "FlashList",
  "LegendList",
  "SectionList",
  "VirtualizedList",
]);

// HACK: virtualized lists key off referential equality of `data`. Passing
// `data={items.map(...)}` allocates a fresh array on every parent render,
// which forces the list to re-key every row and bust its memo cache,
// destroying scroll perf. Hoist the transform into a useMemo at list
// scope or do the projection earlier in the parent.
export const rnListDataMapped = defineRule<Rule>({
  id: "rn-list-data-mapped",
  requires: ["react-native"],
  severity: "warn",
  recommendation:
    "Wrap the projection in `useMemo(() => items.map(...), [items])` so the list's `data` prop has a stable reference across parent renders",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      const elementName = resolveJsxElementName(node);
      if (!elementName || !VIRTUALIZED_LIST_NAMES.has(elementName)) return;

      for (const attr of node.attributes ?? []) {
        if (!isNodeOfType(attr, "JSXAttribute")) continue;
        if (!isNodeOfType(attr.name, "JSXIdentifier") || attr.name.name !== "data") continue;
        if (!isNodeOfType(attr.value, "JSXExpressionContainer")) continue;
        const expression = attr.value.expression;
        if (!isNodeOfType(expression, "CallExpression")) continue;
        if (!isNodeOfType(expression.callee, "MemberExpression")) continue;
        if (!isNodeOfType(expression.callee.property, "Identifier")) continue;
        const methodName = expression.callee.property.name;
        if (methodName !== "map" && methodName !== "filter") continue;

        context.report({
          node: attr,
          message: `<${elementName} data={items.${methodName}(...)}> allocates a fresh array per render — wrap in useMemo at list scope so the data reference stays stable across parent renders`,
        });
        return;
      }
    },
  }),
});
