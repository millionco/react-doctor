import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { resolveJsxElementName } from "./utils/resolve-jsx-element-name.js";
import { isExpoUiComponentElement } from "./utils/is-expo-ui-component-element.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const NON_VIRTUALIZED_SCROLL_CONTAINERS = new Set(["ScrollView"]);

const ARRAY_ITERATION_METHODS = new Set(["map", "flatMap"]);

const isArrayIterationExpression = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  if (!isNodeOfType(node.callee, "MemberExpression")) return false;
  if (!isNodeOfType(node.callee.property, "Identifier")) return false;

  if (ARRAY_ITERATION_METHODS.has(node.callee.property.name)) return true;

  if (
    node.callee.property.name === "filter" ||
    node.callee.property.name === "slice" ||
    node.callee.property.name === "sort" ||
    node.callee.property.name === "reverse" ||
    node.callee.property.name === "concat"
  ) {
    return isArrayIterationExpression(node.callee.object);
  }
  return false;
};

// HACK: <ScrollView>{items.map(...)}</ScrollView> renders every row in
// memory — for any list longer than ~10 items this destroys scroll
// performance on lower-end devices. FlashList / LegendList / FlatList
// recycle row components and only mount the visible window.
export const rnNoScrollviewMappedList = defineRule<Rule>({
  id: "rn-no-scrollview-mapped-list",
  title: "Non-virtualized mapped list in ScrollView",
  tags: ["test-noise"],
  requires: ["react-native"],
  severity: "warn",
  recommendation:
    "`<ScrollView>{items.map(...)}</ScrollView>` builds every row at once, which slows scrolling. Use FlashList, LegendList, or FlatList instead.",
  create: (context: RuleContext) => ({
    JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
      const elementName = resolveJsxElementName(node.openingElement);
      if (!elementName || !NON_VIRTUALIZED_SCROLL_CONTAINERS.has(elementName)) return;

      // Universal UI's `<ScrollView>` is a native scroll container — RN's
      // virtualized lists can't compose inside its `<Host>` tree, so the
      // FlashList/FlatList advice doesn't apply. `@expo/ui` ships its own
      // `<List>` for long content instead.
      if (isExpoUiComponentElement(node.openingElement, node, "ScrollView")) return;

      for (const child of node.children ?? []) {
        if (!isNodeOfType(child, "JSXExpressionContainer")) continue;
        const expression = child.expression;
        if (isArrayIterationExpression(expression)) {
          context.report({
            node: child,
            message: `Your users get slow scrolling when <${elementName}> with items.map(...) builds every row at once.`,
          });
          return;
        }
      }
    },
  }),
});
