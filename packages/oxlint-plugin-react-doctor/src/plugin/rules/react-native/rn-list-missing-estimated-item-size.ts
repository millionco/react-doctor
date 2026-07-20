import { defineRule } from "../../utils/define-rule.js";
import { getReactDoctorNumberSetting } from "../../utils/get-react-doctor-setting.js";
import {
  FLASH_LIST_V2_MAJOR,
  RECYCLABLE_LIST_PACKAGE_SOURCES,
} from "../../constants/react-native.js";
import { hasImportFromModules } from "../../utils/find-import-source-for-name.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { resolveJsxElementName } from "../../utils/resolve-jsx-element-name.js";
import { resolveImportedRecyclerName } from "./utils/resolve-imported-recycler-name.js";
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

const SIZING_HINT_ATTRIBUTE_NAMES = new Set(["estimatedItemSize", "estimatedListSize"]);

const isFlashListV2OrNewer = (context: RuleContext): boolean => {
  const flashListMajorVersion = getReactDoctorNumberSetting(
    context.settings,
    "shopifyFlashListMajorVersion",
  );
  return flashListMajorVersion !== undefined && flashListMajorVersion >= FLASH_LIST_V2_MAJOR;
};

const isEmptyArrayLiteral = (node: EsTreeNodeOfType<"JSXAttribute">): boolean => {
  if (!isNodeOfType(node.value, "JSXExpressionContainer")) return false;
  const expression = node.value.expression;
  return isNodeOfType(expression, "ArrayExpression") && (expression.elements?.length ?? 0) === 0;
};

export const rnListMissingEstimatedItemSize = defineRule({
  id: "rn-list-missing-estimated-item-size",
  title: "List missing estimatedItemSize",
  tags: ["test-noise"],
  requires: ["react-native"],
  severity: "warn",
  recommendation:
    "Without `estimatedItemSize` the list guesses row height and can flash blank cells on fast scroll. Add `estimatedItemSize={<avg-row-height-in-px>}` so it matches your rows.",
  create: (context: RuleContext) => {
    let fileImportsRecycler = false;
    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        fileImportsRecycler = hasImportFromModules(node, RECYCLABLE_LIST_PACKAGE_SOURCES);
      },
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (!fileImportsRecycler) return;
        const localElementName = resolveJsxElementName(node);
        if (!localElementName) return;
        // Resolve the LOCAL JSX name back to its originally-exported
        // symbol from one of the recycler-owning packages. This handles
        // both plain (`import { FlashList }`) and aliased
        // (`import { FlashList as List }; <List />`) imports — we never
        // key off the local JSX name directly.
        const canonicalRecyclerName = resolveImportedRecyclerName(node, localElementName);
        if (canonicalRecyclerName === null) return;
        if (canonicalRecyclerName === "FlashList" && isFlashListV2OrNewer(context)) return;

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
          message: `Your users see blank cells flash on fast scroll when <${localElementName}> has no \`estimatedItemSize\`.`,
        });
      },
    };
  },
});
