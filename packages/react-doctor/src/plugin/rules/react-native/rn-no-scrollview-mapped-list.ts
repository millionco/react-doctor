import { defineRule } from "../../utils/define-rule.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { resolveJsxElementName } from "./utils/resolve-jsx-element-name.js";
import { SCROLLVIEW_NAMES } from "./utils/scrollview_names.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// HACK: <ScrollView>{items.map(...)}</ScrollView> renders every row in
// memory — for any list longer than ~10 items this destroys scroll
// performance on lower-end devices. FlashList / LegendList / FlatList
// recycle row components and only mount the visible window. The cost
// of switching is tiny (same prop API) and the perf win is huge.
export const rnNoScrollviewMappedList = defineRule<Rule>({
  requires: ["react-native"],
  framework: "react-native",
  severity: "warn",
  category: "React Native",
  recommendation:
    "Use FlashList, LegendList, or FlatList — `<ScrollView>{items.map(...)}</ScrollView>` mounts every row in memory",
  examples: [
    {
      before: "<ScrollView>{items.map((item) => <Row key={item.id} item={item} />)}</ScrollView>",
      after: "<FlatList data={items} keyExtractor={(item) => item.id} renderItem={renderRow} />",
    },
  ],
  create: (context: RuleContext) => ({
    JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
      const elementName = resolveJsxElementName(node.openingElement);
      if (!elementName || !SCROLLVIEW_NAMES.has(elementName)) return;

      for (const child of node.children ?? []) {
        if (!isNodeOfType(child, "JSXExpressionContainer")) continue;
        const expression = child.expression;
        if (
          isNodeOfType(expression, "CallExpression") &&
          isNodeOfType(expression.callee, "MemberExpression") &&
          isNodeOfType(expression.callee.property, "Identifier") &&
          expression.callee.property.name === "map"
        ) {
          context.report({
            node: child,
            message: `<${elementName}> rendering items.map(...) — use FlashList, LegendList, or FlatList so only visible rows mount`,
          });
          return;
        }
      }
    },
  }),
});
