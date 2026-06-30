import {
  REACT_NATIVE_LIST_COMPONENTS,
  RECYCLABLE_LIST_PACKAGES,
} from "../../constants/react-native.js";
import { defineRule } from "../../utils/define-rule.js";
import {
  getImportedNameFromModule,
  getImportSourceForName,
} from "../../utils/find-import-source-for-name.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { resolveJsxElementName } from "./utils/resolve-jsx-element-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const REACT_NATIVE_MODULE_SOURCE = "react-native";

// True when the local JSX name genuinely refers to a virtualized list, not a
// same-named local component. Recyclers (FlashList/LegendList) must be imported
// from their owning package; the built-in RN lists fire for a `react-native`
// import or an ambient/global reference, but not when the name is rebound to a
// local declaration (`const FlatList = MyTable`) or a different package.
const isVirtualizedList = (node: EsTreeNode, elementName: string): boolean => {
  const recyclerPackages = RECYCLABLE_LIST_PACKAGES[elementName];
  if (recyclerPackages) {
    return recyclerPackages.some(
      (packageSource) =>
        getImportedNameFromModule(node, elementName, packageSource) === elementName,
    );
  }
  const importSource = getImportSourceForName(node, elementName);
  if (importSource !== null) return importSource === REACT_NATIVE_MODULE_SOURCE;
  return findVariableInitializer(node, elementName) === null;
};

const FRESH_ARRAY_METHODS = new Set([
  "map",
  "filter",
  "toSorted",
  "slice",
  "toReversed",
  "concat",
  "flat",
  "flatMap",
  "toSpliced",
]);

const isFreshArrayExpression = (node: EsTreeNode): string | null => {
  if (isNodeOfType(node, "ArrayExpression")) {
    // `data={[]}` is an empty-state / placeholder branch with zero rows, so
    // there is no per-row memo cost to warn about (matches the empty-array
    // skip in rn-list-missing-estimated-item-size). Non-empty inline arrays
    // still allocate a fresh reference every render.
    if ((node.elements?.length ?? 0) === 0) return null;
    return "[...spread]";
  }

  if (isNodeOfType(node, "CallExpression")) {
    const callee = node.callee;

    if (isNodeOfType(callee, "MemberExpression")) {
      if (isNodeOfType(callee.property, "Identifier")) {
        const methodName = callee.property.name;
        if (FRESH_ARRAY_METHODS.has(methodName)) return `.${methodName}(…)`;

        if (
          methodName === "from" &&
          isNodeOfType(callee.object, "Identifier") &&
          callee.object.name === "Array"
        ) {
          return "Array.from(…)";
        }
      }
      return isFreshArrayExpression(callee.object);
    }

    if (isNodeOfType(callee, "Identifier") && callee.name === "Array") {
      return "Array(…)";
    }
  }

  return null;
};

// HACK: virtualized lists key off referential equality of `data`. Passing
// `data={items.map(...)}` (or .filter, .sort, .slice, .reverse, .concat,
// .flat, .flatMap, [...spread]) allocates a fresh array on every parent
// render, busting the memo cache for every row. Hoist the transform into
// a useMemo or do the projection earlier.
export const rnListDataMapped = defineRule({
  id: "rn-list-data-mapped",
  title: "List data rebuilt every render",
  tags: ["test-noise"],
  requires: ["react-native"],
  severity: "warn",
  recommendation:
    "This builds a new array each time the parent redraws, so every row redraws too. Wrap it in `useMemo(() => items.map(...), [items])` to keep the same array.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      const elementName = resolveJsxElementName(node);
      if (!elementName || !REACT_NATIVE_LIST_COMPONENTS.has(elementName)) return;
      if (!isVirtualizedList(node, elementName)) return;

      for (const attr of node.attributes ?? []) {
        if (!isNodeOfType(attr, "JSXAttribute")) continue;
        if (!isNodeOfType(attr.name, "JSXIdentifier") || attr.name.name !== "data") continue;
        if (!isNodeOfType(attr.value, "JSXExpressionContainer")) continue;
        const expression = attr.value.expression;

        const freshArrayDescription = isFreshArrayExpression(expression);
        if (!freshArrayDescription) continue;

        context.report({
          node: attr,
          message: `Your users see every row redraw when <${elementName}> gets a new data array each render.`,
        });
        return;
      }
    },
  }),
});
