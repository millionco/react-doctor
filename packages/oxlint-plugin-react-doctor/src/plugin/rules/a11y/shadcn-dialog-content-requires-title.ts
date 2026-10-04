import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getTrailingJsxNameSegment } from "../../utils/get-trailing-jsx-name-segment.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import {
  SHADCN_UI_MODULE_SOURCE_PATTERN,
  resolveShadcnUiComponentName,
} from "../../utils/resolve-shadcn-ui-component-name.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { JsxSubtreePartScan } from "../../utils/scan-jsx-subtree-for-part.js";
import { scanJsxSubtreeForPart } from "../../utils/scan-jsx-subtree-for-part.js";

interface DialogSurfaceContract {
  readonly contentComponent: string;
  readonly titleComponent: string;
  readonly moduleSourcePattern: RegExp;
}

// Radix's Dialog primitive (which shadcn's dialog, sheet, alert-dialog, and
// vaul-backed drawer modules wrap) requires a Title inside Content — without
// one the dialog has no accessible name and Radix logs a runtime
// accessibility error.
const DIALOG_SURFACE_CONTRACTS: ReadonlyArray<DialogSurfaceContract> = [
  {
    contentComponent: "DialogContent",
    titleComponent: "DialogTitle",
    moduleSourcePattern: /(?:^|\/)ui\/(?:.*\/)?dialog$|^\.\.?\/(?:.*\/)?dialog$/,
  },
  {
    contentComponent: "SheetContent",
    titleComponent: "SheetTitle",
    moduleSourcePattern: /(?:^|\/)ui\/(?:.*\/)?sheet$|^\.\.?\/(?:.*\/)?sheet$/,
  },
  {
    contentComponent: "AlertDialogContent",
    titleComponent: "AlertDialogTitle",
    moduleSourcePattern: /(?:^|\/)ui\/(?:.*\/)?alert-dialog$|^\.\.?\/(?:.*\/)?alert-dialog$/,
  },
  {
    contentComponent: "DrawerContent",
    titleComponent: "DrawerTitle",
    moduleSourcePattern: /(?:^|\/)ui\/(?:.*\/)?drawer$|^\.\.?\/(?:.*\/)?drawer$/,
  },
];

// `aria-label` names the dialog directly; `aria-labelledby` delegates to any
// element; `title` is the accessible-name fallback. Presence (even dynamic)
// counts as named.
const NAME_PROVIDING_ATTRIBUTES = ["aria-label", "aria-labelledby", "title"] as const;

const isTitleElementName = (
  elementName: EsTreeNode,
  contract: DialogSurfaceContract,
  context: RuleContext,
): boolean =>
  resolveShadcnUiComponentName(elementName, contract.moduleSourcePattern, context) ===
    contract.titleComponent ||
  // A local wrapper or re-export named exactly like the title part —
  // trusting the name here trades a rare false negative for zero noise on
  // projects that centralize their dialog headers.
  getTrailingJsxNameSegment(elementName) === contract.titleComponent;

const scanContentForTitle = (
  contentElement: EsTreeNodeOfType<"JSXElement">,
  contract: DialogSurfaceContract,
  context: RuleContext,
): JsxSubtreePartScan =>
  scanJsxSubtreeForPart(contentElement.children, {
    isPartElementName: (elementName) => isTitleElementName(elementName, contract, context),
    // An unresolved custom component may render the title itself
    // (`<ConfirmDialogHeader/>`), so a missing-title claim is unprovable;
    // components generated into `ui/` modules are known leaves. Opaque
    // elements still recurse, so a title nested through them counts.
    isOpaqueElement: (element) => {
      const elementName = element.openingElement.name;
      // Some shadcn-compatible distributions render the header part's text
      // AS the dialog title (Intent UI's DrawerHeader), so a same-module
      // header with content makes the missing-title claim unprovable.
      const resolvedPartName = resolveShadcnUiComponentName(
        elementName,
        contract.moduleSourcePattern,
        context,
      );
      if (resolvedPartName !== null) {
        return (
          resolvedPartName === "DrawerHeader" &&
          element.children.some(
            (child) => isNodeOfType(child, "JSXText") && child.value.trim().length > 0,
          )
        );
      }
      const trailingSegment = getTrailingJsxNameSegment(elementName);
      return (
        trailingSegment !== null &&
        /^[A-Z]/.test(trailingSegment) &&
        trailingSegment !== "Fragment" &&
        resolveShadcnUiComponentName(elementName, SHADCN_UI_MODULE_SOURCE_PATTERN, context) === null
      );
    },
  });

export const shadcnDialogContentRequiresTitle = defineRule({
  id: "shadcn-dialog-content-requires-title",
  title: "Dialog content without a title",
  severity: "warn",
  requires: ["shadcn"],
  recommendation:
    "Give every DialogContent, SheetContent, AlertDialogContent, and DrawerContent a matching title part (wrapped in an sr-only element when the design shows no heading) or name the dialog with aria-label.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      for (const contract of DIALOG_SURFACE_CONTRACTS) {
        if (
          resolveShadcnUiComponentName(node.name, contract.moduleSourcePattern, context) !==
          contract.contentComponent
        ) {
          continue;
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
        const scan = scanContentForTitle(element, contract, context);
        if (scan.foundPart || scan.sawOpaqueContent) return;
        context.report({
          node: node.name,
          message: `This ${contract.contentComponent} renders no ${contract.titleComponent}, so the dialog has no accessible name and assistive technology announces an unnamed dialog. Add a ${contract.titleComponent} (visually hidden if the design shows no heading) or an aria-label.`,
        });
        return;
      }
    },
  }),
});
