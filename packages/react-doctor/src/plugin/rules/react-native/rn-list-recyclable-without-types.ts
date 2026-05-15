import { defineRule } from "../../utils/define-rule.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { resolveJsxElementName } from "./utils/resolve-jsx-element-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// HACK: <FlashList recycleItems> (or LegendList) reuses row component
// instances across rows. For HETEROGENEOUS lists (rows of different
// types — section headers, message bubbles, separators), recycling
// without `getItemType` causes wrong-type rows to mount into the
// recycled cells and produces flickers / measurement errors. The fix
// is to provide `getItemType={item => item.kind}` (or similar) so
// FlashList keeps separate recycle pools per type.
//
// Heuristic: <FlashList recycleItems> AND `<FlashList renderItem={...}>`
// where the renderItem return type is varied (multiple JSX element
// names returned via conditional / branching). We approximate by
// flagging any FlashList/LegendList with `recycleItems` and no
// `getItemType` — the user can add `getItemType` if they have one
// item type, in which case the rule is silent.
const RECYCLABLE_LIST_NAMES = new Set(["FlashList", "LegendList"]);

export const rnListRecyclableWithoutTypes = defineRule<Rule>({
  id: "rn-list-recyclable-without-types",
  requires: ["react-native"],
  severity: "warn",
  recommendation:
    "Add `getItemType={item => item.kind}` so FlashList keeps separate recycle pools per item type — heterogeneous rows shouldn't share recycled cells",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      const elementName = resolveJsxElementName(node);
      if (!elementName || !RECYCLABLE_LIST_NAMES.has(elementName)) return;

      let hasRecycleItemsEnabled = false;
      let hasGetItemType = false;

      for (const attr of node.attributes ?? []) {
        if (!isNodeOfType(attr, "JSXAttribute")) continue;
        if (!isNodeOfType(attr.name, "JSXIdentifier")) continue;
        if (attr.name.name === "recycleItems") {
          // Bare `recycleItems` (no `={...}`) → true. `recycleItems={true}`
          // → true. `recycleItems={false}` → DISABLES recycling, so the
          // rule shouldn't fire.
          if (!attr.value) {
            hasRecycleItemsEnabled = true;
          } else if (
            isNodeOfType(attr.value, "JSXExpressionContainer") &&
            isNodeOfType(attr.value.expression, "Literal")
          ) {
            hasRecycleItemsEnabled = attr.value.expression.value === true;
          } else {
            // Dynamic value: assume it can be true.
            hasRecycleItemsEnabled = true;
          }
        }
        if (attr.name.name === "getItemType") hasGetItemType = true;
      }

      if (hasRecycleItemsEnabled && !hasGetItemType) {
        context.report({
          node,
          message: `<${elementName} recycleItems> without \`getItemType\` — heterogeneous rows mount into the wrong recycled cells. Add \`getItemType={item => item.kind}\` so FlashList keeps separate recycle pools per type`,
        });
      }
    },
  }),
});
