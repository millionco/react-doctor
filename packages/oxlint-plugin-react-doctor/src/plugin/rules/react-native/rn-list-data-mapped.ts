import {
  REACT_NATIVE_BUILTIN_LIST_COMPONENTS,
  REACT_NATIVE_LIST_MODULE_SOURCES,
} from "../../constants/react-native.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import { defineRule } from "../../utils/define-rule.js";
import { findDeclaratorForBinding } from "../../utils/find-declarator-for-binding.js";
import { getImportBindingForName } from "../../utils/find-import-source-for-name.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { getInitializerModuleSource } from "../../utils/get-initializer-module-source.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { resolveJsxElementName } from "../../utils/resolve-jsx-element-name.js";
import { resolveImportedRecyclerName } from "./utils/resolve-imported-recycler-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const getJsxMemberRootObjectName = (jsxElementName: EsTreeNode): string | null => {
  let objectNode: EsTreeNode = jsxElementName;
  while (isNodeOfType(objectNode, "JSXMemberExpression")) {
    objectNode = objectNode.object;
  }
  return isNodeOfType(objectNode, "JSXIdentifier") ? objectNode.name : null;
};

// Classifies a non-import local binding of a built-in list name. A declarator
// initialized from a `require("react-native")` (`const { FlatList } = ...` /
// `require("react-native").FlatList`) or from a react-native namespace import
// (`const { FlatList } = RN` / the member alias `const FlatList = RN.FlatList`)
// is still the real RN list; any other initializer is a local rebinding
// (`const FlatList = MyTable`). No binding at all — an ambient/global
// reference — keeps the base fire-by-name behavior.
const isLocalBindingReactNativeList = (node: EsTreeNode, elementName: string): boolean => {
  const localBinding = findVariableInitializer(node, elementName);
  if (localBinding === null) return true;
  const declarator = findDeclaratorForBinding(localBinding.bindingIdentifier);
  if (declarator === null) return false;
  const declaratorInitializer = declarator.init;
  if (!declaratorInitializer) return true;
  const initializerModuleSource = getInitializerModuleSource(node, declaratorInitializer);
  return (
    initializerModuleSource !== null &&
    REACT_NATIVE_LIST_MODULE_SOURCES.has(initializerModuleSource)
  );
};

// True when the local JSX name genuinely refers to a virtualized list, not a
// same-named local component. Recyclers (FlashList/LegendList) must resolve to
// a real import from their owning package — which also covers aliased imports
// (`import { FlashList as FL }`) and namespace member access. The built-in RN
// lists fire for an import / require / namespace destructure from a
// react-native list source (or an ambient/global reference like
// `Animated.FlatList`), but not when the name is rebound to a local
// declaration (`const FlatList = MyTable`) or member-accessed on an object
// imported from an unrelated module (`<Styled.FlatList>`).
const isVirtualizedList = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  elementName: string,
  scopes: ScopeAnalysis,
): boolean => {
  if (
    resolveImportedRecyclerName(node, scopes, {
      allowNamespaceMemberAccess: true,
    }) !== null
  )
    return true;
  if (isNodeOfType(node.name, "JSXMemberExpression")) {
    if (!REACT_NATIVE_BUILTIN_LIST_COMPONENTS.has(elementName)) return false;
    const memberObjectName = getJsxMemberRootObjectName(node.name);
    if (memberObjectName === null) return false;
    const objectImportBinding = getImportBindingForName(node, memberObjectName);
    if (objectImportBinding === null) return true;
    return REACT_NATIVE_LIST_MODULE_SOURCES.has(objectImportBinding.source);
  }
  const importBinding = getImportBindingForName(node, elementName);
  if (importBinding !== null) {
    const canonicalName = importBinding.exportedName ?? elementName;
    return (
      REACT_NATIVE_LIST_MODULE_SOURCES.has(importBinding.source) &&
      REACT_NATIVE_BUILTIN_LIST_COMPONENTS.has(canonicalName)
    );
  }
  if (!REACT_NATIVE_BUILTIN_LIST_COMPONENTS.has(elementName)) return false;
  return isLocalBindingReactNativeList(node, elementName);
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
  // React Compiler memoizes the `.map(...)` result, so the array keeps its
  // identity between renders and memoized rows are not busted. Mirrors the
  // gate on the sibling `rn-*` inline-prop rules.
  disabledWhen: ["react-compiler"],
  severity: "warn",
  recommendation:
    "This builds a new array each time the parent redraws, so every row redraws too. Wrap it in `useMemo(() => items.map(...), [items])` to keep the same array.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      const elementName = resolveJsxElementName(node);
      if (!elementName || !isVirtualizedList(node, elementName, context.scopes)) return;

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
