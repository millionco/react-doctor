import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getElementType } from "../../utils/get-element-type.js";
import { getStaticTemplateLiteralValue } from "../../utils/get-static-template-literal-value.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isTestlikeFilename } from "../../utils/is-testlike-filename.js";
import type { Rule } from "../../utils/rule.js";
import { HTML_TAGS } from "../../constants/html-tags.js";

const MESSAGE =
  "Screen reader & keyboard users get disoriented because `autoFocus` jumps focus on load, so remove it and let people choose where to focus.";

interface NoAutofocusSettings {
  ignoreNonDOM?: boolean;
}

const resolveSettings = (
  settings: Readonly<Record<string, unknown>> | undefined,
): Required<NoAutofocusSettings> => {
  const reactDoctor = settings?.["react-doctor"];
  const ruleSettings =
    typeof reactDoctor === "object" && reactDoctor !== null
      ? ((reactDoctor as { noAutofocus?: NoAutofocusSettings }).noAutofocus ?? {})
      : {};
  // Default to `true`: `autoFocus` on a CUSTOM component is the
  // consumer delegating focus to a wrapper that itself manages how /
  // when / whether to focus. The component is the right place to
  // enforce the a11y rule (its internal `<input autoFocus />` would
  // be flagged) — flagging the consumer creates noise for every
  // design-system input that forwards the prop. Match jsx-a11y's
  // multi-year default.
  return { ignoreNonDOM: ruleSettings.ignoreNonDOM ?? true };
};

// Strip parens around an expression — OXC's ESTree parser doesn't
// emit ParenthesizedExpression by default, but be defensive.
const innerExpression = (expression: EsTreeNode): EsTreeNode => {
  if (
    (expression as { type: string }).type === "ParenthesizedExpression" &&
    "expression" in expression
  ) {
    return innerExpression((expression as { expression: EsTreeNode }).expression);
  }
  return expression;
};

// `autoFocus={autoFocus}` — the component is just forwarding the
// consumer's prop value. The consumer site is where the rule should
// fire, not the trampoline. (Without this, every well-behaved input
// wrapper that exposes `autoFocus` to its caller gets flagged.)
const isSameNameIdentifierForward = (attributeName: string, value: EsTreeNode | null): boolean => {
  if (!value || !isNodeOfType(value, "JSXExpressionContainer")) return false;
  const expression = innerExpression(value.expression as EsTreeNode);
  if (isNodeOfType(expression, "Identifier") && expression.name === attributeName) {
    return true;
  }
  // `autoFocus={props.autoFocus}` — same shape, just destructured at
  // the call site.
  if (
    isNodeOfType(expression, "MemberExpression") &&
    !expression.computed &&
    isNodeOfType(expression.property, "Identifier") &&
    expression.property.name === attributeName
  ) {
    return true;
  }
  return false;
};

// Returns true when an attribute value is statically equivalent to
// `false` (per OXC's `is_false_attribute_value`).
const isFalseAttributeValue = (value: EsTreeNode): boolean => {
  if (isNodeOfType(value, "Literal")) {
    return typeof value.value === "string" ? value.value === "false" : value.value === false;
  }
  if (isNodeOfType(value, "JSXExpressionContainer")) {
    const expression = innerExpression(value.expression);
    if (isNodeOfType(expression, "Literal")) {
      if (typeof expression.value === "boolean") return !expression.value;
      if (typeof expression.value === "string") return expression.value === "false";
      return false;
    }
    if (isNodeOfType(expression, "TemplateLiteral")) {
      return getStaticTemplateLiteralValue(expression) === "false";
    }
  }
  return false;
};

// Port of `oxc_linter::rules::jsx_a11y::no_autofocus`. Reports any
// case-sensitive `autoFocus=` attribute on JSX elements whose value
// isn't statically `false`. With `ignoreNonDOM: true`, only HTML
// elements (lowercase tag in HTML_TAGS) are checked.
export const noAutofocus = defineRule<Rule>({
  id: "no-autofocus",
  title: "Autofocus on an element",
  tags: ["react-jsx-only"],
  severity: "warn",
  recommendation: "Do not use `autoFocus`. It disorients users on load.",
  category: "Accessibility",
  create: (context) => {
    const settings = resolveSettings(context.settings);
    const isTestlikeFile = isTestlikeFilename(context.filename);
    return {
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (isTestlikeFile) return;
        const autoFocusAttribute = node.attributes.find((attribute) => {
          if (!isNodeOfType(attribute as EsTreeNode, "JSXAttribute")) return false;
          const attributeName = (attribute as EsTreeNodeOfType<"JSXAttribute">).name;
          return (
            isNodeOfType(attributeName as EsTreeNode, "JSXIdentifier") &&
            (attributeName as EsTreeNodeOfType<"JSXIdentifier">).name === "autoFocus"
          );
        });
        if (!autoFocusAttribute) return;
        const attributeValue = (autoFocusAttribute as EsTreeNodeOfType<"JSXAttribute">)
          .value as EsTreeNode | null;
        if (attributeValue && isFalseAttributeValue(attributeValue)) return;
        if (isSameNameIdentifierForward("autoFocus", attributeValue)) return;
        if (settings.ignoreNonDOM) {
          const tag = getElementType(node, context.settings);
          if (!HTML_TAGS.has(tag)) return;
        }
        context.report({ node: autoFocusAttribute as EsTreeNode, message: MESSAGE });
      },
    };
  },
});
