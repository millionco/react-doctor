import { defineRule } from "../../utils/define-rule.js";
import { getImportedNameFromModule } from "../../utils/find-import-source-for-name.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { resolveJsxElementName } from "./utils/resolve-jsx-element-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// HACK: FlashList / LegendList compute their initial container pool
// from `estimatedItemSize` via
//   numContainers = ceil(((viewport - header + drawDistance × 2) / avg) × cols)
// If you don't supply it, the engine falls back to a hard-coded
// default (FlashList warns at runtime; LegendList doesn't). When the
// real row size is much larger than the default, the visible viewport
// renders blank cells until the engine measures and re-allocates,
// producing the "blank flash on fast scroll" artifact. LegendList
// accepts `estimatedItemSize` OR `estimatedListSize` (the latter is
// a richer per-list hint), so either silences the rule.

// Source-of-truth packages: only fire when the JSX element name resolves
// to one of these via a real ES module import. A homegrown component
// named `FlashList` in a different package (or imported from a wrapper)
// shouldn't pretend to be the Shopify/Legend recycler.
const RECYCLABLE_LIST_PACKAGES: Record<string, ReadonlyArray<string>> = {
  FlashList: ["@shopify/flash-list"],
  LegendList: ["@legendapp/list"],
};

const SIZING_HINT_ATTRIBUTE_NAMES = new Set(["estimatedItemSize", "estimatedListSize"]);

const isEmptyArrayLiteral = (node: EsTreeNodeOfType<"JSXAttribute">): boolean => {
  if (!isNodeOfType(node.value, "JSXExpressionContainer")) return false;
  const expression = node.value.expression;
  return isNodeOfType(expression, "ArrayExpression") && (expression.elements?.length ?? 0) === 0;
};

export const rnListMissingEstimatedItemSize = defineRule<Rule>({
  id: "rn-list-missing-estimated-item-size",
  tags: ["test-noise"],
  requires: ["react-native"],
  severity: "warn",
  recommendation:
    "Add `estimatedItemSize={<avg-row-height-in-px>}` so the initial container pool matches the real rows — without it the engine guesses and flashes blank cells on fast scroll",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      const localElementName = resolveJsxElementName(node);
      if (!localElementName) return;
      // Resolve the LOCAL JSX name back to its originally-exported
      // symbol from one of the recycler-owning packages. This handles
      // both plain (`import { FlashList }`) and aliased
      // (`import { FlashList as List }; <List />`) imports — we never
      // key off the local JSX name directly.
      let canonicalRecyclerName: string | null = null;
      for (const [canonicalName, packageSources] of Object.entries(RECYCLABLE_LIST_PACKAGES)) {
        const matched = packageSources.some(
          (packageSource) =>
            getImportedNameFromModule(node, localElementName, packageSource) === canonicalName,
        );
        if (matched) {
          canonicalRecyclerName = canonicalName;
          break;
        }
      }
      if (!canonicalRecyclerName) return;

      let hasSizingHint = false;
      let dataIsEmptyLiteral = false;
      let hasDataProp = false;

      for (const attribute of node.attributes ?? []) {
        if (!isNodeOfType(attribute, "JSXAttribute")) continue;
        if (!isNodeOfType(attribute.name, "JSXIdentifier")) continue;
        const attributeName = attribute.name.name;
        if (SIZING_HINT_ATTRIBUTE_NAMES.has(attributeName)) hasSizingHint = true;
        if (attributeName === "data") {
          hasDataProp = true;
          if (isEmptyArrayLiteral(attribute)) dataIsEmptyLiteral = true;
        }
      }

      if (hasSizingHint) return;
      // Skip placeholder lists — `<FlashList data={[]} />` is almost
      // always a render-with-empty-data branch, not a production code
      // path, and adding `estimatedItemSize` there is busywork.
      if (dataIsEmptyLiteral) return;
      // Skip JSX that doesn't even pass `data` — likely an
      // abstract wrapper component being defined, not an instantiation
      // with real items.
      if (!hasDataProp) return;

      context.report({
        node,
        message: `<${localElementName}> (from ${canonicalRecyclerName}) is missing \`estimatedItemSize\` — the engine guesses the initial container pool from a default that often mismatches your rows, causing blank flashes on fast scroll`,
      });
    },
  }),
});
