import { VALID_ARIA_ROLES } from "../../constants/aria-roles.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { flattenJsxName } from "../../utils/flatten-jsx-name.js";
import { getElementType } from "../../utils/get-element-type.js";
import { getJsxPropStaticStringValues } from "../../utils/get-jsx-prop-static-string-values.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import { isHiddenFromScreenReader } from "../../utils/is-hidden-from-screen-reader.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isTestlikeFilename } from "../../utils/is-testlike-filename.js";
import { objectHasAccessibleChild } from "../../utils/object-has-accessible-child.js";

const MESSAGE =
  "Blind users can't follow this link because screen readers announce nothing, so add visible text, `aria-label`, or `aria-labelledby`.";

const hasLinkRole = (roleValue: string): boolean =>
  roleValue
    .trim()
    .split(/\s+/)
    .find((roleToken) => VALID_ARIA_ROLES.has(roleToken)) === "link";

// An empty anchor passed as a prop of react-i18next's `<Trans>`
// (`components={{ link: <a … /> }}`) is a template: Trans clones it and
// injects the translated text as children at runtime, so the rendered
// link DOES have an accessible name.
const isTransComponentsTemplate = (node: EsTreeNodeOfType<"JSXElement">): boolean => {
  let current: EsTreeNode | null | undefined = node.parent;
  while (current) {
    if (isNodeOfType(current, "JSXAttribute")) {
      const owner = current.parent;
      if (owner && isNodeOfType(owner, "JSXOpeningElement")) {
        return flattenJsxName(owner.name as EsTreeNode) === "Trans";
      }
      return false;
    }
    current = current.parent ?? null;
  }
  return false;
};

// Port of `oxc_linter::rules::jsx_a11y::anchor_has_content`.
export const anchorHasContent = defineRule({
  id: "anchor-has-content",
  title: "Anchor has no content",
  tags: ["react-jsx-only"],
  severity: "warn",
  recommendation: "Put readable text inside every link.",
  category: "Accessibility",
  create: (context) => {
    const isTestlikeFile = isTestlikeFilename(context.filename);
    return {
      JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
        if (isTestlikeFile) return;
        const opening = node.openingElement;
        const tag = getElementType(opening, context.settings);
        if (tag !== "a") return;
        const hrefAttribute = hasJsxPropIgnoreCase(opening.attributes, "href");
        const roleAttribute = hasJsxPropIgnoreCase(opening.attributes, "role");
        const roleValues = roleAttribute
          ? getJsxPropStaticStringValues(roleAttribute, context.scopes)
          : [];
        const canHaveLinkRole =
          roleValues === null || roleValues.some((roleValue) => hasLinkRole(roleValue));
        if (!hrefAttribute && !canHaveLinkRole) return;
        if (isHiddenFromScreenReader(opening, context.settings)) return;
        if (objectHasAccessibleChild(node, context.settings)) return;
        for (const attribute of ["title", "aria-label", "aria-labelledby"]) {
          if (hasJsxPropIgnoreCase(opening.attributes, attribute)) return;
        }
        if (isTransComponentsTemplate(node)) return;
        context.report({ node: opening.name, message: MESSAGE });
      },
    };
  },
});
