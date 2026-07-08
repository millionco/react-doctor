import {
  buildSameFileMemoRegistry,
  memoStatusForJsxOpeningName,
  type MemoStatus,
} from "../../utils/build-same-file-memo-registry.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { hasCustomMemoComparator } from "../../utils/has-custom-memo-comparator.js";
import { isInsideFunctionScope } from "../../utils/is-inside-function-scope.js";
import { isJsxAttributeOnIntrinsicHtmlElement } from "../../utils/is-on-intrinsic-html-element.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isTestlikeFilename } from "../../utils/is-testlike-filename.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import {
  ALWAYS_FRESH_OBJECT_PROPS,
  CONFIG_OBJECT_PROP_NAMES,
  CONFIG_OBJECT_PROP_SUFFIXES,
} from "./jsx-no-new-object-as-prop-tables.js";

const MESSAGE =
  "This child redraws every render because the prop gets a brand new object each time.";

const isConfigObjectPropName = (propName: string): boolean => {
  if (CONFIG_OBJECT_PROP_NAMES.has(propName)) return true;
  for (const suffix of CONFIG_OBJECT_PROP_SUFFIXES) {
    if (propName.length > suffix.length && propName.endsWith(suffix)) return true;
  }
  return false;
};

const OBJECT_CONSTRUCTOR_NAMES = new Set(["Object"]);
const OBJECT_PRODUCING_METHODS = new Set([
  "assign",
  "create",
  "fromEntries",
  "groupBy",
  "freeze",
  "seal",
]);

const isEmptyObjectLiteralExpression = (expression: EsTreeNode): boolean => {
  const stripped = stripParenExpression(expression);
  return isNodeOfType(stripped, "ObjectExpression") && (stripped.properties ?? []).length === 0;
};

const isObjectProducingExpression = (expression: EsTreeNode): boolean => {
  const stripped = stripParenExpression(expression);
  if (isNodeOfType(stripped, "ObjectExpression")) return true;
  if (isNodeOfType(stripped, "NewExpression")) {
    return (
      isNodeOfType(stripped.callee, "Identifier") &&
      OBJECT_CONSTRUCTOR_NAMES.has(stripped.callee.name)
    );
  }
  if (isNodeOfType(stripped, "CallExpression")) {
    if (
      isNodeOfType(stripped.callee, "Identifier") &&
      OBJECT_CONSTRUCTOR_NAMES.has(stripped.callee.name)
    ) {
      return true;
    }
    if (
      isNodeOfType(stripped.callee, "MemberExpression") &&
      isNodeOfType(stripped.callee.object, "Identifier") &&
      stripped.callee.object.name === "Object" &&
      isNodeOfType(stripped.callee.property, "Identifier") &&
      OBJECT_PRODUCING_METHODS.has(stripped.callee.property.name)
    ) {
      return true;
    }
    return false;
  }
  if (isNodeOfType(stripped, "LogicalExpression")) {
    // `value ?? {}` / `{} || value` — an empty object literal on
    // either side is a fallback that only allocates on the rare
    // null/undefined path. Same reasoning as the array variant; if
    // NEITHER side is the empty-fallback shape (e.g.
    // `style={opts ?? makeDefaults()}` where `makeDefaults()` itself
    // allocates an object), the expression always allocates so we
    // check both.
    if (stripped.operator === "??" || stripped.operator === "||") {
      const leftIsEmptyFallback = isEmptyObjectLiteralExpression(stripped.left);
      const rightIsEmptyFallback = isEmptyObjectLiteralExpression(stripped.right);
      if (leftIsEmptyFallback) return isObjectProducingExpression(stripped.right);
      if (rightIsEmptyFallback) return isObjectProducingExpression(stripped.left);
    }
    return (
      isObjectProducingExpression(stripped.left) || isObjectProducingExpression(stripped.right)
    );
  }
  if (isNodeOfType(stripped, "ConditionalExpression")) {
    return (
      isObjectProducingExpression(stripped.consequent) ||
      isObjectProducingExpression(stripped.alternate)
    );
  }
  return false;
};

const followsRenderLocalObjectBinding = (
  expression: EsTreeNode,
  jsxAttribute: EsTreeNode,
): boolean => {
  const stripped = stripParenExpression(expression);
  if (!isNodeOfType(stripped, "Identifier")) return false;
  const binding = findVariableInitializer(stripped, stripped.name);
  if (!binding || !binding.initializer) return false;
  let walker: EsTreeNode | null = jsxAttribute;
  while (walker) {
    if (walker === binding.scopeOwner) {
      if (binding.scopeOwner.type === "Program") return false;
      break;
    }
    walker = walker.parent ?? null;
  }
  return isObjectProducingExpression(binding.initializer);
};

// Port of `oxc_linter::rules::react_perf::jsx_no_new_object_as_prop`.
// See `jsx-no-new-array-as-prop` for the shared shape; this one flags
// ObjectExpression / new Object() / Object.assign() / Object.create()
// etc. and the same conditional / logical wrappings. The render-local
// identifier-binding case (`const x = {}; <C prop={x} />`) is covered
// via the same `findVariableInitializer` lookup used by the sister
// rules.
export const jsxNoNewObjectAsProp = defineRule({
  id: "jsx-no-new-object-as-prop",
  title: "New object passed as a prop",
  tags: ["react-jsx-only"],
  severity: "warn",
  // React Compiler auto-memoizes prop allocations, so the perf footgun
  // this rule guards against doesn't exist in compiler-enabled projects.
  disabledWhen: ["react-compiler"],
  recommendation:
    "Wrap the object in `useMemo` or move it outside the component so memoized children do not redraw every render.",
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
        // object literals on them is unactionable. See the same skip
        // in `jsx-no-new-function-as-prop` for the full rationale.
        if (isJsxAttributeOnIntrinsicHtmlElement(node)) return;
        // Same-file plain-function consumer — `React.memo` rationale
        // doesn't apply.
        const parentJsxOpening = node.parent;
        const openingName =
          parentJsxOpening && isNodeOfType(parentJsxOpening, "JSXOpeningElement")
            ? (parentJsxOpening.name as EsTreeNode)
            : null;
        // Only fire when same-file analysis PROVES the consumer is
        // memoised. "unknown" and "not-memoised" both short-circuit —
        // see jsx-no-new-function-as-prop for the audit data.
        if (memoStatusForJsxOpeningName(memoRegistry, openingName) !== "memoised") return;
        // `memo(fn, arePropsEqual)` compares props with the author's own
        // function, which routinely ignores reference identity (antd's
        // MemoInput, json-edit-react's CollectionNode) — a fresh object
        // cannot break that bailout.
        if (hasCustomMemoComparator(openingName)) return;
        if (!isInsideFunctionScope(node)) return;
        if (!isNodeOfType(node.name, "JSXIdentifier")) return;
        if (ALWAYS_FRESH_OBJECT_PROPS.has(node.name.name)) return;
        // Configuration-shape props (`options`, `config`, `theme`,
        // `wrapperProps`, etc. + `*Props` / `*Config` / `*Options`
        // suffixes) receive inline literals by design — chart libs,
        // animation libs, design systems all use this pattern. The
        // perf footgun the rule targets is hot-path identity changes;
        // config slots aren't that.
        if (isConfigObjectPropName(node.name.name)) return;
        const value = node.value;
        if (!value || !isNodeOfType(value, "JSXExpressionContainer")) return;
        const expression = value.expression;
        if (!expression || expression.type === "JSXEmptyExpression") return;
        const expressionNode = expression as EsTreeNode;
        if (
          !isObjectProducingExpression(expressionNode) &&
          !followsRenderLocalObjectBinding(expressionNode, node)
        ) {
          return;
        }
        context.report({ node, message: MESSAGE });
      },
    };
  },
});
