import {
  buildSameFileMemoRegistry,
  memoStatusForJsxOpeningName,
  type MemoStatus,
} from "../../utils/build-same-file-memo-registry.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isInsideFunctionScope } from "../../utils/is-inside-function-scope.js";
import { isJsxAttributeOnIntrinsicHtmlElement } from "../../utils/is-on-intrinsic-html-element.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { RuleContext } from "../../utils/rule-context.js";

interface EmptyFallback {
  readonly emptyKind: "array" | "object";
  readonly emptyNode: EsTreeNode;
  readonly nonEmptyExpression: EsTreeNode;
}

const isEmptyArrayLiteral = (expression: EsTreeNode): boolean => {
  const stripped = stripParenExpression(expression);
  return isNodeOfType(stripped, "ArrayExpression") && (stripped.elements ?? []).length === 0;
};

const isEmptyObjectLiteral = (expression: EsTreeNode): boolean => {
  const stripped = stripParenExpression(expression);
  return isNodeOfType(stripped, "ObjectExpression") && (stripped.properties ?? []).length === 0;
};

// Anchors the "non-empty" side to a STABLE expression — an identifier
// or a plain non-computed member-access chain (`props.posts`,
// `state.user.name`). When the non-empty side is itself a function
// call or another allocation, `jsx-no-new-array-as-prop` /
// `jsx-no-new-object-as-prop` already fire on the inner allocation,
// so this rule would only duplicate that diagnostic.
const isStableNonEmptyExpression = (expression: EsTreeNode): boolean => {
  const stripped = stripParenExpression(expression);
  if (isNodeOfType(stripped, "Identifier")) return true;
  if (isNodeOfType(stripped, "ThisExpression")) return true;
  if (isNodeOfType(stripped, "MemberExpression")) {
    if (stripped.computed) return false;
    const object = stripped.object;
    if (!object) return false;
    return isStableNonEmptyExpression(object);
  }
  return false;
};

const matchEmptyFallbackInLogicalExpression = (expression: EsTreeNode): EmptyFallback | null => {
  const stripped = stripParenExpression(expression);
  if (!isNodeOfType(stripped, "LogicalExpression")) return null;
  if (stripped.operator !== "||" && stripped.operator !== "??") return null;

  const left = stripped.left;
  const right = stripped.right;
  if (!left || !right) return null;

  // 3perf canonical pattern: empty literal on the RIGHT (the fallback
  // side), stable expression on the left. The symmetric `[] || value`
  // / `{} ?? value` shape is intentionally NOT handled — `[]` and `{}`
  // are always truthy/non-null in JS, so the right side becomes dead
  // code. That's a typo / dead-code bug, not the perf footgun this
  // rule targets, and the diagnostic message would be inverted.
  if (isEmptyArrayLiteral(right) && isStableNonEmptyExpression(left)) {
    return { emptyKind: "array", emptyNode: right, nonEmptyExpression: left };
  }
  if (isEmptyObjectLiteral(right) && isStableNonEmptyExpression(left)) {
    return { emptyKind: "object", emptyNode: right, nonEmptyExpression: left };
  }

  return null;
};

const buildMessage = (emptyKind: "array" | "object"): string => {
  const literal = emptyKind === "array" ? "[]" : "{}";
  const example =
    emptyKind === "array" ? "const EMPTY_ITEMS: Item[] = []" : "const EMPTY_CONFIG: Config = {}";
  return `This redraws the memo child anyway because fallback \`${literal}\` builds a brand new ${emptyKind} each render when the left value is empty, so the child sees a different value. Hoist a constant (e.g. \`${example}\`) & use that as the fallback.`;
};

// React Compiler auto-memoises this allocation, so the rule is
// `disabledWhen: ["react-compiler"]` — it only fires on projects that
// hand-write memoisation. Companion to `jsx-no-new-array-as-prop`,
// which intentionally exempts the `x || []` shape; this rule fills
// that gap when the right side is literally `[]` / `{}` AND the
// downstream consumer is memoised.
//
// Detection summary:
//   - JSX attribute on a same-file `memo(...)`-wrapped component
//   - Attribute value is `<stable expr> (|||??) []` (or `{}`)
//   - Stable expr := identifier / non-computed member chain / `this`
//   - Intrinsic HTML elements are skipped (not memoised)
//   - Inside function scope only — module-level JSX is allocated once
export const preferStableEmptyFallback = defineRule({
  id: "prefer-stable-empty-fallback",
  title: "Empty fallback rebuilt each render",
  tags: ["react-jsx-only", "test-noise"],
  severity: "warn",
  category: "Performance",
  disabledWhen: ["react-compiler"],
  recommendation:
    "Make a `const EMPTY = []` (or `{}`) at module scope and use it as the `||` / `??` fallback, so the value stays the same each render.",
  create: (context: RuleContext) => {
    let memoRegistry: Map<string, MemoStatus> | null = null;
    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        memoRegistry = buildSameFileMemoRegistry(node as EsTreeNode);
      },
      JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
        if (!node.value) return;
        if (!isNodeOfType(node.value, "JSXExpressionContainer")) return;
        const innerExpression = node.value.expression;
        if (!innerExpression) return;
        if (innerExpression.type === "JSXEmptyExpression") return;
        if (!isInsideFunctionScope(node)) return;
        if (isJsxAttributeOnIntrinsicHtmlElement(node)) return;

        const parentJsxOpening = node.parent;
        const openingName =
          parentJsxOpening && isNodeOfType(parentJsxOpening, "JSXOpeningElement")
            ? (parentJsxOpening.name as EsTreeNode)
            : null;
        if (memoStatusForJsxOpeningName(memoRegistry, openingName) !== "memoised") return;

        const fallback = matchEmptyFallbackInLogicalExpression(innerExpression);
        if (!fallback) return;

        context.report({
          node: fallback.emptyNode,
          message: buildMessage(fallback.emptyKind),
        });
      },
    };
  },
});
