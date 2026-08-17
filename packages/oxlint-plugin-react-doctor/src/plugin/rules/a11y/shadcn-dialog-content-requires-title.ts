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
import { visitStaticJsxChildren } from "../../utils/visit-static-jsx-children.js";
import { walkAst } from "../../utils/walk-ast.js";

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
    moduleSourcePattern: /(?:^|\/)dialog$/,
  },
  {
    contentComponent: "SheetContent",
    titleComponent: "SheetTitle",
    moduleSourcePattern: /(?:^|\/)sheet$/,
  },
  {
    contentComponent: "AlertDialogContent",
    titleComponent: "AlertDialogTitle",
    moduleSourcePattern: /(?:^|\/)alert-dialog$/,
  },
  {
    contentComponent: "DrawerContent",
    titleComponent: "DrawerTitle",
    moduleSourcePattern: /(?:^|\/)drawer$/,
  },
];

// `aria-label` names the dialog directly; `aria-labelledby` delegates to any
// element; `title` is the accessible-name fallback. Presence (even dynamic)
// counts as named.
const NAME_PROVIDING_ATTRIBUTES = ["aria-label", "aria-labelledby", "title"] as const;

interface DialogSubtreeScan {
  foundTitle: boolean;
  sawOpaqueContent: boolean;
}

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
): DialogSubtreeScan => {
  const scan: DialogSubtreeScan = { foundTitle: false, sawOpaqueContent: false };
  visitStaticJsxChildren(contentElement.children, {
    onElement: (element) => {
      const elementName = element.openingElement.name;
      if (isTitleElementName(elementName, contract, context)) {
        scan.foundTitle = true;
        return false;
      }
      const trailingSegment = getTrailingJsxNameSegment(elementName);
      const isCustomComponent =
        trailingSegment !== null &&
        /^[A-Z]/.test(trailingSegment) &&
        trailingSegment !== "Fragment";
      if (
        isCustomComponent &&
        resolveShadcnUiComponentName(elementName, SHADCN_UI_MODULE_SOURCE_PATTERN, context) === null
      ) {
        // An unresolved custom component may render the title itself
        // (`<ConfirmDialogHeader/>`), so a missing-title claim is unprovable.
        // Still recurse: a title nested through it should count.
        scan.sawOpaqueContent = true;
      }
      return true;
    },
    onOpaqueExpression: (expression) => {
      scan.sawOpaqueContent = true;
      // The expression renders content we can't statically enumerate, but any
      // JSX literally written inside it (map callbacks, IIFE branches) is
      // still visible — finding a title there keeps the report honest.
      walkAst(expression, (node) => {
        if (
          isNodeOfType(node, "JSXOpeningElement") &&
          isTitleElementName(node.name, contract, context)
        ) {
          scan.foundTitle = true;
        }
      });
    },
  });
  return scan;
};

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
        if (scan.foundTitle || scan.sawOpaqueContent) return;
        context.report({
          node: node.name,
          message: `This ${contract.contentComponent} renders no ${contract.titleComponent}, so the dialog has no accessible name and assistive technology announces an unnamed dialog. Add a ${contract.titleComponent} (visually hidden if the design shows no heading) or an aria-label.`,
        });
        return;
      }
    },
  }),
});
