import { defineRule } from "../../utils/define-rule.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { isConstDeclaredBinding } from "../../utils/is-const-declared-binding.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { resolveJsxElementName } from "../../utils/resolve-jsx-element-name.js";
import { isExpoUiComponentElement } from "./utils/is-expo-ui-component-element.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const NON_VIRTUALIZED_SCROLL_CONTAINERS = new Set(["ScrollView"]);

const ARRAY_ITERATION_METHODS = new Set(["map", "flatMap", "reduce"]);

// The doc's FP carve-out: for a fixed-length array under ~10 rows,
// virtualization overhead outweighs the mount cost.
const SHORT_FIXED_LIST_MAX_ROW_COUNT = 10;

// Array methods that never grow the receiver, so the receiver's static
// length bounds the result.
const LENGTH_PRESERVING_ARRAY_METHODS = new Set(["fill", "slice", "filter", "sort", "reverse"]);

const STATIC_LENGTH_RESOLUTION_MAX_DEPTH = 8;

// Upper bound on the mapped array's length when statically knowable:
// `[0, 1]`, `Array(5).fill(null)`, a `const` bound to an array literal, a
// conditional between two bounded arrays, or a length-preserving method
// chain over any of those. `null` means unbounded/unknown — keep firing.
const staticMaxArrayLength = (node: EsTreeNode, resolutionDepth = 0): number | null => {
  if (resolutionDepth > STATIC_LENGTH_RESOLUTION_MAX_DEPTH) return null;
  if (isNodeOfType(node, "ArrayExpression")) {
    const elements = node.elements ?? [];
    if (elements.some((element) => element && isNodeOfType(element, "SpreadElement"))) return null;
    return elements.length;
  }
  if (isNodeOfType(node, "CallExpression") || isNodeOfType(node, "NewExpression")) {
    const callee = node.callee;
    if (isNodeOfType(callee, "Identifier") && callee.name === "Array") {
      const lengthArgument = node.arguments?.[0];
      if (
        node.arguments?.length === 1 &&
        isNodeOfType(lengthArgument, "Literal") &&
        typeof lengthArgument.value === "number"
      ) {
        return lengthArgument.value;
      }
      return null;
    }
    if (
      isNodeOfType(node, "CallExpression") &&
      isNodeOfType(callee, "MemberExpression") &&
      isNodeOfType(callee.property, "Identifier") &&
      LENGTH_PRESERVING_ARRAY_METHODS.has(callee.property.name)
    ) {
      return staticMaxArrayLength(callee.object, resolutionDepth + 1);
    }
    return null;
  }
  if (isNodeOfType(node, "ConditionalExpression")) {
    const consequentLength = staticMaxArrayLength(node.consequent, resolutionDepth + 1);
    const alternateLength = staticMaxArrayLength(node.alternate, resolutionDepth + 1);
    if (consequentLength === null || alternateLength === null) return null;
    return Math.max(consequentLength, alternateLength);
  }
  if (isNodeOfType(node, "Identifier")) {
    const binding = findVariableInitializer(node, node.name);
    if (!binding?.initializer || !isConstDeclaredBinding(binding)) return null;
    return staticMaxArrayLength(binding.initializer, resolutionDepth + 1);
  }
  return null;
};

const isShortFixedLengthIteration = (node: EsTreeNodeOfType<"CallExpression">): boolean => {
  if (!isNodeOfType(node.callee, "MemberExpression")) return false;
  const maxLength = staticMaxArrayLength(node.callee.object);
  return maxLength !== null && maxLength <= SHORT_FIXED_LIST_MAX_ROW_COUNT;
};

const isReduceBuildingJsxRows = (node: EsTreeNodeOfType<"CallExpression">): boolean => {
  if (!isNodeOfType(node.callee, "MemberExpression")) return false;
  if (!isNodeOfType(node.callee.property, "Identifier") || node.callee.property.name !== "reduce") {
    return false;
  }
  const rowBuilder = node.arguments?.[0];
  if (!rowBuilder || !isFunctionLike(rowBuilder)) return false;
  let buildsJsx = false;
  walkAst(rowBuilder, (child) => {
    if (isNodeOfType(child, "JSXElement")) buildsJsx = true;
  });
  return buildsJsx;
};

const isArrayIterationExpression = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  if (!isNodeOfType(node.callee, "MemberExpression")) return false;
  if (!isNodeOfType(node.callee.property, "Identifier")) return false;

  if (node.callee.property.name === "reduce") return isReduceBuildingJsxRows(node);

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
export const rnNoScrollviewMappedList = defineRule({
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
          // `.flatMap` can expand each item into several rows, so the
          // receiver's length doesn't bound the row count — only `.map`
          // qualifies for the short-fixed-array carve-out.
          if (
            isNodeOfType(expression, "CallExpression") &&
            isNodeOfType(expression.callee, "MemberExpression") &&
            isNodeOfType(expression.callee.property, "Identifier") &&
            expression.callee.property.name === "map" &&
            isShortFixedLengthIteration(expression)
          ) {
            continue;
          }
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
