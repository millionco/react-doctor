import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { hasJsxKeyAttribute } from "../../utils/has-jsx-key-attribute.js";
import { isJsxFragmentElement } from "../../utils/is-jsx-fragment-element.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";

const NEEDS_MORE_CHILDREN = "This fragment wraps a single child & does nothing.";
const CHILD_OF_HTML_ELEMENT =
  "This fragment does nothing inside an HTML tag that can hold the children directly.";

interface JsxNoUselessFragmentSettings {
  allowExpressions?: boolean;
}

const resolveSettings = (
  settings: Readonly<Record<string, unknown>> | undefined,
): Required<JsxNoUselessFragmentSettings> => {
  const reactDoctor = settings?.["react-doctor"];
  const ruleSettings =
    typeof reactDoctor === "object" && reactDoctor !== null
      ? ((reactDoctor as { jsxNoUselessFragment?: JsxNoUselessFragmentSettings })
          .jsxNoUselessFragment ?? {})
      : {};
  return { allowExpressions: ruleSettings.allowExpressions ?? false };
};

// Mirrors OXC's `is_padding_spaces`: a JSXText is "padding" (i.e.
// filler) only when it's whitespace-only AND contains a newline.
// Single-space text between children is meaningful and counts toward
// the child total.
const isPaddingChild = (child: EsTreeNode): boolean => {
  if (!isNodeOfType(child, "JSXText")) return false;
  return child.value.trim().length === 0 && child.value.includes("\n");
};

const stripWhitespaceOnlyText = (children: ReadonlyArray<EsTreeNode>): EsTreeNode[] => {
  const filtered: EsTreeNode[] = [];
  for (const child of children) {
    if (isPaddingChild(child)) continue;
    filtered.push(child);
  }
  return filtered;
};

// Mirrors OXC's "any child is `{call()}`" escape hatch in
// `has_less_than_two_children`. A fragment with even one
// `{someCall()}` child is presumed deliberate (the call may return a
// fragment / list / null).
const hasCallExpressionChild = (children: ReadonlyArray<EsTreeNode>): boolean => {
  for (const child of children) {
    if (!isNodeOfType(child, "JSXExpressionContainer")) continue;
    if (isNodeOfType(child.expression, "CallExpression")) return true;
  }
  return false;
};

const isLowercaseHtmlTag = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "JSXOpeningElement")) return false;
  const elementName = node.name;
  if (!isNodeOfType(elementName, "JSXIdentifier")) return false;
  const firstCharacter = elementName.name.charCodeAt(0);
  return firstCharacter >= 97 && firstCharacter <= 122;
};

const isChildOfHtmlElement = (node: EsTreeNode): boolean => {
  const parent = node.parent;
  if (!parent) return false;
  if (!isNodeOfType(parent, "JSXElement")) return false;
  return isLowercaseHtmlTag(parent.openingElement as EsTreeNode);
};

const isFragmentWithSingleExpression = (children: ReadonlyArray<EsTreeNode>): boolean => {
  const meaningful = stripWhitespaceOnlyText(children);
  if (meaningful.length !== 1) return false;
  return isNodeOfType(meaningful[0], "JSXExpressionContainer");
};

// Mirrors OXC's `is_fragment_with_only_text_and_is_not_child`: a
// fragment with exactly one Text child whose parent is NOT itself a
// JSXElement/JSXFragment escapes the "needs more children" check —
// `<Foo content={<>just text</>} />` is the canonical example.
const isFragmentWithOnlyTextAndNotJsxChild = (
  fragmentNode: EsTreeNode,
  children: ReadonlyArray<EsTreeNode>,
): boolean => {
  if (children.length !== 1) return false;
  if (!isNodeOfType(children[0], "JSXText")) return false;
  const parent = fragmentNode.parent;
  if (!parent) return false;
  return !isNodeOfType(parent, "JSXElement") && !isNodeOfType(parent, "JSXFragment");
};

// Port of `oxc_linter::rules::react::jsx_no_useless_fragment`. Reports
//   - `<></>` / `<Fragment></Fragment>` with 0 or 1 (non-whitespace) child
//   - `<><X /></>` directly inside an HTML element (HTML can hold the
//     child directly).
// Honors `allowExpressions: true` to permit `<>{expr}</>`.
export const jsxNoUselessFragment = defineRule<Rule>({
  id: "jsx-no-useless-fragment",
  title: "Unnecessary React fragment",
  severity: "warn",
  // Single-child fragments are often intentional — they force the
  // return type to `ReactNode` rather than `ReactElement` (broader and
  // safer for callers), and they keep conditional renders symmetric
  // (`shouldShow ? <>{children}</> : null`). Default off; users who
  // want strict cleanup can opt in.
  defaultEnabled: false,
  recommendation:
    "Drop the fragment when it wraps a single child or sits directly under an HTML tag.",
  category: "Architecture",
  create: (context) => {
    const { allowExpressions } = resolveSettings(context.settings);

    // Returns true when the fragment was reported (so callers know not
    // to also fire the more specific child-of-HTML diagnostic on the
    // same node). Avoids the duplicate-diagnostic foot-gun Bugbot caught.
    const checkChildren = (
      fragmentNode: EsTreeNode,
      reportNode: EsTreeNode,
      children: ReadonlyArray<EsTreeNode>,
    ): boolean => {
      const meaningful = stripWhitespaceOnlyText(children);
      if (meaningful.length >= 2) return false;
      if (allowExpressions && isFragmentWithSingleExpression(children)) return false;
      if (hasCallExpressionChild(meaningful)) return false;
      if (isFragmentWithOnlyTextAndNotJsxChild(fragmentNode, meaningful)) return false;
      context.report({ node: reportNode, message: NEEDS_MORE_CHILDREN });
      return true;
    };

    return {
      JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
        const openingElement = node.openingElement;
        if (!isJsxFragmentElement(openingElement as EsTreeNode)) return;
        if (hasJsxKeyAttribute(openingElement)) return;
        const didReport = checkChildren(node, openingElement, node.children);
        if (didReport) return;
        if (isChildOfHtmlElement(node)) {
          context.report({ node: openingElement, message: CHILD_OF_HTML_ELEMENT });
        }
      },
      JSXFragment(node: EsTreeNodeOfType<"JSXFragment">) {
        const didReport = checkChildren(node, node.openingFragment, node.children);
        if (didReport) return;
        if (isChildOfHtmlElement(node)) {
          context.report({ node: node.openingFragment, message: CHILD_OF_HTML_ELEMENT });
        }
      },
    };
  },
});
