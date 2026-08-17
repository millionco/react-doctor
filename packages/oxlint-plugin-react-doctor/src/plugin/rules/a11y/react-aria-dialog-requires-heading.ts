import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getTrailingJsxNameSegment } from "../../utils/get-trailing-jsx-name-segment.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveShadcnUiComponentName } from "../../utils/resolve-shadcn-ui-component-name.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { RuleVisitors } from "../../utils/rule-visitors.js";
import { scanJsxSubtreeForPart } from "../../utils/scan-jsx-subtree-for-part.js";

const REACT_ARIA_COMPONENTS_MODULE_PATTERN = /^react-aria-components$/;
const NAME_PROVIDING_ATTRIBUTES = ["aria-label", "aria-labelledby"] as const;

// React Aria's Dialog takes its accessible name from a `<Heading
// slot="title">` child or an explicit aria-label / aria-labelledby —
// without one, assistive technology announces an unnamed dialog.
const isHeadingElementName = (elementName: EsTreeNode, context: RuleContext): boolean =>
  resolveShadcnUiComponentName(elementName, REACT_ARIA_COMPONENTS_MODULE_PATTERN, context) ===
    "Heading" ||
  // A local wrapper named like the heading part — trusting the name trades a
  // rare false negative for zero noise on apps that restyle Heading.
  getTrailingJsxNameSegment(elementName) === "Heading";

export const reactAriaDialogRequiresHeading = defineRule({
  id: "react-aria-dialog-requires-heading",
  title: "React Aria dialog without a heading",
  severity: "warn",
  requires: ["react-aria"],
  recommendation:
    'Give every React Aria Dialog a <Heading slot="title"> child or name the dialog with aria-label / aria-labelledby.',
  create: (context: RuleContext): RuleVisitors => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (
        resolveShadcnUiComponentName(node.name, REACT_ARIA_COMPONENTS_MODULE_PATTERN, context) !==
        "Dialog"
      ) {
        return;
      }
      // A spread can supply aria-label / children at runtime.
      if (hasJsxSpreadAttribute(node.attributes)) return;
      if (
        NAME_PROVIDING_ATTRIBUTES.some((attribute) =>
          hasJsxPropIgnoreCase(node.attributes, attribute),
        )
      ) {
        return;
      }
      const element = node.parent;
      if (!element || !isNodeOfType(element, "JSXElement") || element.children.length === 0) {
        return;
      }
      const scan = scanJsxSubtreeForPart(element.children, {
        isPartElementName: (elementName) => isHeadingElementName(elementName, context),
        // Same-library components (Button, TextField, …) are known leaves;
        // any unresolved custom component may render the heading itself, so
        // the claim becomes unprovable. Opaque elements still recurse, so a
        // heading nested through them counts — and headings written inside
        // the common `{({ close }) => …}` render-prop child are found by the
        // opaque-expression deep search.
        isOpaqueElement: (childElement) => {
          const childName = childElement.openingElement.name;
          if (
            resolveShadcnUiComponentName(
              childName,
              REACT_ARIA_COMPONENTS_MODULE_PATTERN,
              context,
            ) !== null
          ) {
            return false;
          }
          const trailingSegment = getTrailingJsxNameSegment(childName);
          return (
            trailingSegment !== null &&
            /^[A-Z]/.test(trailingSegment) &&
            trailingSegment !== "Fragment"
          );
        },
      });
      if (scan.foundPart || scan.sawOpaqueContent) return;
      context.report({
        node: node.name,
        message:
          'This Dialog renders no Heading, so it has no accessible name and assistive technology announces an unnamed dialog. Add a <Heading slot="title"> (visually hidden if the design shows no heading) or an aria-label.',
      });
    },
  }),
});
