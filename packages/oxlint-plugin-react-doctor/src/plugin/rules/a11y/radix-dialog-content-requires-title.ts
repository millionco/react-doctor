import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getTrailingJsxNameSegment } from "../../utils/get-trailing-jsx-name-segment.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveNamespacedPartName } from "../../utils/resolve-namespaced-part-name.js";
import { resolveShadcnUiComponentName } from "../../utils/resolve-shadcn-ui-component-name.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { scanJsxSubtreeForPart } from "../../utils/scan-jsx-subtree-for-part.js";
import type { RuleVisitors } from "../../utils/rule-visitors.js";

const RADIX_UNIFIED_MODULE_PATTERN = /^radix-ui$/;

interface RadixDialogSurface {
  // "Dialog" / "AlertDialog" — the unified package's namespace export and
  // the human name in diagnostics.
  readonly namespaceName: string;
  // The per-primitive package ("@radix-ui/react-dialog"), whose exports are
  // the bare parts (Content, Title, …).
  readonly primitiveModulePattern: RegExp;
}

// Radix's Dialog primitive requires a Title inside Content — without one the
// dialog has no accessible name and Radix logs a runtime accessibility error.
const RADIX_DIALOG_SURFACES: ReadonlyArray<RadixDialogSurface> = [
  { namespaceName: "Dialog", primitiveModulePattern: /^@radix-ui\/react-dialog$/ },
  { namespaceName: "AlertDialog", primitiveModulePattern: /^@radix-ui\/react-alert-dialog$/ },
];

const NAME_PROVIDING_ATTRIBUTES = ["aria-label", "aria-labelledby", "title"] as const;

// Resolves an element to a Radix part name for one surface, across both
// import styles: `import * as Dialog from "@radix-ui/react-dialog"` /
// `import { Content } from "@radix-ui/react-dialog"` (per-primitive) and
// `import { Dialog } from "radix-ui"` with `<Dialog.Content>` (unified).
const resolveRadixPartName = (
  elementName: EsTreeNode,
  surface: RadixDialogSurface,
  context: RuleContext,
): string | null =>
  resolveShadcnUiComponentName(elementName, surface.primitiveModulePattern, context) ??
  resolveNamespacedPartName(
    elementName,
    RADIX_UNIFIED_MODULE_PATTERN,
    surface.namespaceName,
    context,
  );

const isTitleElementName = (
  elementName: EsTreeNode,
  surface: RadixDialogSurface,
  context: RuleContext,
): boolean => {
  if (resolveRadixPartName(elementName, surface, context) === "Title") return true;
  // A local wrapper named like the title part ("Title", "DialogTitle") —
  // trusting the name trades a rare false negative for zero noise.
  const trailingSegment = getTrailingJsxNameSegment(elementName);
  return trailingSegment === "Title" || trailingSegment === `${surface.namespaceName}Title`;
};

export const radixDialogContentRequiresTitle = defineRule({
  id: "radix-dialog-content-requires-title",
  title: "Radix dialog content without a title",
  severity: "warn",
  requires: ["radix-ui"],
  recommendation:
    "Give every Radix Dialog.Content and AlertDialog.Content a Title part (wrapped in VisuallyHidden when the design shows no heading) or name the dialog with aria-label.",
  create: (context: RuleContext): RuleVisitors => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      for (const surface of RADIX_DIALOG_SURFACES) {
        if (resolveRadixPartName(node.name, surface, context) !== "Content") continue;
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
          isPartElementName: (elementName) => isTitleElementName(elementName, surface, context),
          // Same-surface parts (Close, Description, Overlay, …) are known
          // leaves; any unresolved custom component may render the title
          // itself, so the claim becomes unprovable. Opaque elements still
          // recurse, so a title nested through them (e.g. inside
          // VisuallyHidden) counts.
          isOpaqueElement: (childElement) => {
            const childName = childElement.openingElement.name;
            if (resolveRadixPartName(childName, surface, context) !== null) return false;
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
          message: `This ${surface.namespaceName}.Content renders no ${surface.namespaceName}.Title, so the dialog has no accessible name and Radix logs an accessibility error at runtime. Add a Title part (wrapped in VisuallyHidden if the design shows no heading) or an aria-label.`,
        });
        return;
      }
    },
  }),
});
