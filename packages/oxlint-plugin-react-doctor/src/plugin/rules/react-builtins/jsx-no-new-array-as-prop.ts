import {
  buildSameFileMemoRegistry,
  memoStatusForJsxOpeningName,
  type MemoStatus,
} from "../../utils/build-same-file-memo-registry.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { isInsideFunctionScope } from "../../utils/is-inside-function-scope.js";
import { isJsxAttributeOnIntrinsicHtmlElement } from "../../utils/is-on-intrinsic-html-element.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isTestlikeFilename } from "../../utils/is-testlike-filename.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { Rule } from "../../utils/rule.js";
import {
  DATA_ARRAY_PROP_NAMES,
  DATA_ARRAY_PROP_SUFFIXES,
} from "./jsx-no-new-array-as-prop-tables.js";

const MESSAGE =
  "This child redraws every render because the prop gets a brand new array each time.";

const isDataArrayPropName = (propName: string): boolean => {
  if (DATA_ARRAY_PROP_NAMES.has(propName)) return true;
  for (const suffix of DATA_ARRAY_PROP_SUFFIXES) {
    if (propName.length > suffix.length && propName.endsWith(suffix)) return true;
  }
  return false;
};

const ARRAY_CONSTRUCTOR_NAMES = new Set(["Array"]);
// `.map(fn)` / `.filter(fn)` always take exactly one callback argument
// — flagging them with a different arity is almost certainly a false
// positive on a non-Array `.map`/`.filter` (e.g. `Map#map` doesn't exist
// but custom utilities might). `.concat` is the odd one: zero args is a
// shallow copy, multi-args is a multi-element concat — both still
// allocate a new array, so we don't restrict by arity for it.
const SINGLE_ARG_ARRAY_METHODS = new Set(["map", "filter"]);
const ANY_ARG_ARRAY_METHODS = new Set(["concat"]);

const isEmptyArrayLiteralExpression = (expression: EsTreeNode): boolean => {
  const stripped = stripParenExpression(expression);
  return isNodeOfType(stripped, "ArrayExpression") && (stripped.elements ?? []).length === 0;
};

const isArrayProducingExpression = (expression: EsTreeNode): boolean => {
  const stripped = stripParenExpression(expression);
  if (isNodeOfType(stripped, "ArrayExpression")) return true;
  if (isNodeOfType(stripped, "NewExpression")) {
    return (
      isNodeOfType(stripped.callee, "Identifier") &&
      ARRAY_CONSTRUCTOR_NAMES.has(stripped.callee.name)
    );
  }
  if (isNodeOfType(stripped, "CallExpression")) {
    if (
      isNodeOfType(stripped.callee, "Identifier") &&
      ARRAY_CONSTRUCTOR_NAMES.has(stripped.callee.name)
    ) {
      return true;
    }
    if (
      isNodeOfType(stripped.callee, "MemberExpression") &&
      isNodeOfType(stripped.callee.property, "Identifier")
    ) {
      const methodName = stripped.callee.property.name;
      if (SINGLE_ARG_ARRAY_METHODS.has(methodName) && stripped.arguments.length === 1) {
        return true;
      }
      if (ANY_ARG_ARRAY_METHODS.has(methodName)) return true;
    }
    return false;
  }
  if (isNodeOfType(stripped, "LogicalExpression")) {
    // `value ?? []` / `value || []` — an empty array literal on
    // either side is a fallback that only allocates on the rare
    // null/undefined path. Short-circuit semantics mean `[]` isn't
    // evaluated when the other side is defined. Skip the empty side
    // and check the other; if NEITHER side is an empty fallback, the
    // expression always allocates an array somewhere (e.g.
    // `items={data ?? buildList()}` where `buildList()` is itself
    // array-producing), so check both sides.
    if (stripped.operator === "??" || stripped.operator === "||") {
      const leftIsEmptyFallback = isEmptyArrayLiteralExpression(stripped.left);
      const rightIsEmptyFallback = isEmptyArrayLiteralExpression(stripped.right);
      if (leftIsEmptyFallback) return isArrayProducingExpression(stripped.right);
      if (rightIsEmptyFallback) return isArrayProducingExpression(stripped.left);
    }
    return isArrayProducingExpression(stripped.left) || isArrayProducingExpression(stripped.right);
  }
  if (isNodeOfType(stripped, "ConditionalExpression")) {
    return (
      isArrayProducingExpression(stripped.consequent) ||
      isArrayProducingExpression(stripped.alternate)
    );
  }
  return false;
};

const followsRenderLocalArrayBinding = (
  expression: EsTreeNode,
  jsxAttribute: EsTreeNode,
): boolean => {
  const stripped = stripParenExpression(expression);
  if (!isNodeOfType(stripped, "Identifier")) return false;
  const binding = findVariableInitializer(stripped, stripped.name);
  if (!binding || !binding.initializer) return false;
  // Only flag if the binding's scope owner is also an ancestor of the
  // JSX attribute — i.e. the binding lives in the same render call.
  // Hoisted bindings (module-level / outside the render function) are
  // exempt because they aren't allocated per render.
  let walker: EsTreeNode | null = jsxAttribute;
  while (walker) {
    if (walker === binding.scopeOwner) {
      // Found the scope owner among JSX's ancestors — it's render-local
      // unless it IS the Program (module scope).
      if (binding.scopeOwner.type === "Program") return false;
      break;
    }
    walker = walker.parent ?? null;
  }
  return isArrayProducingExpression(binding.initializer);
};

// Port of `oxc_linter::rules::react_perf::jsx_no_new_array_as_prop`. Flags
// JSX prop values that allocate a new Array per render: `[]`,
// `new Array()`, `Array()`, `arr.concat(x)`, `arr.map(...)`, `arr.filter(...)`,
// and these wrapped in conditional / logical expressions. Top-level JSX
// (outside any function) is skipped — those allocations happen once.
//
// The rule also follows render-local identifier bindings via
// `followsRenderLocalArrayBinding`: `let x = []; return <C list={x} />`
// IS flagged when the binding's scope owner is the render function.
// Hoisted bindings (module-level) are exempt because they aren't
// allocated per render.
export const jsxNoNewArrayAsProp = defineRule<Rule>({
  id: "jsx-no-new-array-as-prop",
  title: "New array passed as a prop",
  tags: ["react-jsx-only"],
  severity: "warn",
  // React Compiler auto-memoizes prop allocations. The perf footgun this
  // rule guards against doesn't exist in compiler-enabled projects.
  disabledBy: ["react-compiler"],
  recommendation:
    "Wrap the array in `useMemo` or move it outside the component so memoized children do not redraw every render.",
  category: "Performance",
  create: (context) => {
    const isTestlikeFile = isTestlikeFilename(context.filename);
    let memoRegistry: Map<string, MemoStatus> | null = null;
    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        memoRegistry = buildSameFileMemoRegistry(node as EsTreeNode);
      },
      JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
        if (isTestlikeFile) return;
        // Intrinsic HTML elements aren't memoized; flagging inline
        // arrays on them is unactionable. See `jsx-no-new-function-as-prop`
        // for the full rationale.
        if (isJsxAttributeOnIntrinsicHtmlElement(node)) return;
        // Consumer-component memo-status: if the parent JSX element
        // is a plain function/arrow defined in this same file (no
        // memo/forwardRef/observer wrapper), the rule's "React.memo
        // bails" rationale doesn't apply — the parent re-renders
        // unconditionally on every prop change.
        const parentJsxOpening = node.parent;
        const openingName =
          parentJsxOpening && isNodeOfType(parentJsxOpening, "JSXOpeningElement")
            ? (parentJsxOpening.name as EsTreeNode)
            : null;
        // Only fire when same-file analysis PROVES the consumer is
        // memoised. "unknown" and "not-memoised" both short-circuit —
        // see jsx-no-new-function-as-prop for the audit data.
        if (memoStatusForJsxOpeningName(memoRegistry, openingName) !== "memoised") return;
        // Data-collection slot props (`items`, `data`, `options`,
        // `tabs`, `*Items`, `*Options`, etc.) receive inline array
        // literals by convention — every list/table/menu/chart
        // component uses this pattern. The perf footgun the rule
        // targets is hot-path identity changes; these are one-time
        // configuration arrays.
        if (isNodeOfType(node.name, "JSXIdentifier") && isDataArrayPropName(node.name.name)) {
          return;
        }
        if (!isInsideFunctionScope(node)) return;
        const value = node.value;
        if (!value || !isNodeOfType(value, "JSXExpressionContainer")) return;
        const expression = value.expression;
        if (!expression || expression.type === "JSXEmptyExpression") return;
        const expressionNode = expression as EsTreeNode;
        if (
          !isArrayProducingExpression(expressionNode) &&
          !followsRenderLocalArrayBinding(expressionNode, node)
        ) {
          return;
        }
        context.report({ node, message: MESSAGE });
      },
    };
  },
});
