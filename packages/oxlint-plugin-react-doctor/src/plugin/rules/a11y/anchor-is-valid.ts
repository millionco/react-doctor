import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { flattenJsxName } from "../../utils/flatten-jsx-name.js";
import { getElementType } from "../../utils/get-element-type.js";
import { getJsxPropStaticStringValues } from "../../utils/get-jsx-prop-static-string-values.js";
import { hasJsxA11ySettings } from "../../utils/has-jsx-a11y-settings.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isTestlikeFilename } from "../../utils/is-testlike-filename.js";

const MESSAGE_MISSING_HREF =
  "Keyboard users can't reach this link because it has no `href`, so add a real `href` (or use `<button>` for actions).";
const MESSAGE_INCORRECT_HREF =
  "Keyboard users can't reach this link because its `href` goes nowhere (`#`, `javascript:`, or empty), so point it at a real destination.";
const MESSAGE_CANT_BE_ANCHOR =
  "Keyboard users can't trigger this link because it's a click handler with no real `href`, so use `<button>` instead.";

interface AnchorIsValidSettings {
  validHrefs?: ReadonlyArray<string>;
}

interface JsxA11ySettings {
  attributes?: { href?: ReadonlyArray<string> };
}

const resolveSettings = (
  settings: Readonly<Record<string, unknown>> | undefined,
): { validHrefs: ReadonlySet<string>; hrefAttributeNames: ReadonlyArray<string> } => {
  const reactDoctor = settings?.["react-doctor"];
  const ruleSettings =
    typeof reactDoctor === "object" && reactDoctor !== null
      ? ((reactDoctor as { anchorIsValid?: AnchorIsValidSettings }).anchorIsValid ?? {})
      : {};
  const jsxA11y = settings?.["jsx-a11y"];
  const a11ySettings =
    typeof jsxA11y === "object" && jsxA11y !== null ? (jsxA11y as JsxA11ySettings) : {};
  return {
    validHrefs: new Set(ruleSettings.validHrefs ?? []),
    hrefAttributeNames: a11ySettings.attributes?.href ?? ["href"],
  };
};

// Next.js `<Link legacyBehavior>` (and the pre-13 default) clones its child
// `<a>` and injects the `href` at render time, so the anchor is reachable
// even though the JSX carries no `href`. Any wrapper component named `Link`
// (or `*Link`) gets the benefit of the doubt — it exists to supply the
// navigation semantics the bare anchor appears to lack.
const isDirectChildOfLinkComponent = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
): boolean => {
  const element = openingElement.parent;
  if (!element || !isNodeOfType(element, "JSXElement")) return false;
  const wrapper = element.parent;
  if (!wrapper || !isNodeOfType(wrapper, "JSXElement")) return false;
  const wrapperName = flattenJsxName(wrapper.openingElement.name);
  if (!wrapperName) return false;
  const lastSegment = wrapperName.split(".").at(-1) ?? wrapperName;
  return lastSegment === "Link" || (lastSegment.endsWith("Link") && lastSegment.length > 4);
};

// An href-less anchor that carries a widget `role`, is focusable via
// `tabIndex`, and handles keys is a hand-rolled control, not an unreachable
// link — the "can't reach this link" claim would be false. (The
// `prefer-tag-over-role` rule separately suggests the native element for
// `<a role="button">`.)
const isKeyboardOperableWidgetAnchor = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
): boolean =>
  Boolean(hasJsxPropIgnoreCase(openingElement.attributes, "role")) &&
  Boolean(hasJsxPropIgnoreCase(openingElement.attributes, "tabindex")) &&
  (Boolean(hasJsxPropIgnoreCase(openingElement.attributes, "onkeydown")) ||
    Boolean(hasJsxPropIgnoreCase(openingElement.attributes, "onkeyup")));

const isInvalidHref = (value: string, validHrefs: ReadonlySet<string>): boolean => {
  if (validHrefs.has(value)) return false;
  return value === "" || value === "#" || value === "javascript:void(0)";
};

// The string-valued cases live in `getJsxPropStaticStringValues`; this
// covers the remaining statically-nowhere shapes: `href={undefined}`,
// `href={null}`, and a fragment value.
const isNullishOrFragmentHref = (value: EsTreeNode): boolean => {
  if (isNodeOfType(value, "JSXExpressionContainer")) {
    const expression = value.expression;
    if (isNodeOfType(expression, "Identifier") && expression.name === "undefined") return true;
    if (isNodeOfType(expression, "Literal") && expression.value === null) return true;
  }
  if (isNodeOfType(value, "JSXFragment")) return true;
  return false;
};

// Port of `oxc_linter::rules::jsx_a11y::anchor_is_valid`.
export const anchorIsValid = defineRule({
  id: "anchor-is-valid",
  title: "Anchor used as a button",
  tags: ["react-jsx-only"],
  severity: "warn",
  recommendation: "Give links a real destination. Use `<button>` for in-page actions.",
  category: "Accessibility",
  create: (context) => {
    const settings = resolveSettings(context.settings);
    const fileHasJsxA11ySettings = hasJsxA11ySettings(context.settings);
    const isTestlikeFile = isTestlikeFilename(context.filename);
    return {
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (isTestlikeFile) return;
        if (
          !fileHasJsxA11ySettings &&
          (!isNodeOfType(node.name, "JSXIdentifier") || node.name.name !== "a")
        ) {
          return;
        }
        const tag = getElementType(node, context.settings);
        if (tag !== "a") return;
        // First-found custom href alternative, falling back to "href".
        let hrefAttribute: ReturnType<typeof hasJsxPropIgnoreCase> | undefined;
        for (const attributeName of settings.hrefAttributeNames) {
          hrefAttribute = hasJsxPropIgnoreCase(node.attributes, attributeName);
          if (hrefAttribute) break;
        }
        if (hrefAttribute) {
          if (!hrefAttribute.value) {
            context.report({ node: node.name, message: MESSAGE_INCORRECT_HREF });
            return;
          }
          // Static resolution covers `href={active ? "#" : ""}` and
          // const-bound hrefs. The "goes nowhere" claim must hold on every
          // path, so ALL candidates have to be invalid — one reachable
          // destination keeps the anchor silent.
          const hrefCandidates = getJsxPropStaticStringValues(hrefAttribute, context.scopes);
          const isEveryCandidateInvalid =
            hrefCandidates !== null
              ? hrefCandidates.length > 0 &&
                hrefCandidates.every((candidate) => isInvalidHref(candidate, settings.validHrefs))
              : isNullishOrFragmentHref(hrefAttribute.value as EsTreeNode);
          if (isEveryCandidateInvalid) {
            const hasOnClick = Boolean(hasJsxPropIgnoreCase(node.attributes, "onClick"));
            // `href="#"` without a click handler is a working scroll-to-top
            // link: it is focusable and navigates to the top of the page, so
            // the "goes nowhere" claim is false (docs-validation FP cluster).
            if (!hasOnClick && hrefCandidates?.every((candidate) => candidate === "#")) {
              return;
            }
            context.report({
              node: node.name,
              message: hasOnClick ? MESSAGE_CANT_BE_ANCHOR : MESSAGE_INCORRECT_HREF,
            });
          }
          return;
        }
        // No href attribute. Skip if there's a spread (could provide href).
        if (hasJsxSpreadAttribute(node.attributes)) return;
        if (isDirectChildOfLinkComponent(node)) return;
        if (isKeyboardOperableWidgetAnchor(node)) return;
        context.report({ node: node.name, message: MESSAGE_MISSING_HREF });
      },
    };
  },
});
