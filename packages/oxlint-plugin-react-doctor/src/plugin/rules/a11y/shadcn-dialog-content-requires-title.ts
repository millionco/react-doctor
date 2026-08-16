import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { flattenJsxName } from "../../utils/flatten-jsx-name.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveShadcnUiComponentName } from "../../utils/resolve-shadcn-ui-component-name.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";

interface DialogSurfaceContract {
  readonly contentComponent: string;
  readonly titleComponent: string;
  readonly moduleSourcePattern: RegExp;
}

// Radix's Dialog primitive (which shadcn's dialog, sheet, and alert-dialog
// modules wrap) requires a Title inside Content — without one the dialog has
// no accessible name and Radix logs a runtime accessibility error.
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
];

// `aria-label` names the dialog directly; `aria-labelledby` delegates to any
// element; `title` is the accessible-name fallback. Presence (even dynamic)
// counts as named.
const NAME_PROVIDING_ATTRIBUTES = ["aria-label", "aria-labelledby", "title"] as const;

// Any module under a `ui/` directory is a shadcn-generated part
// (`@/components/ui/button`, `~/ui/card`). Those are leaf building blocks
// that never render a dialog title internally, so their presence inside
// Content doesn't make the subtree opaque the way an arbitrary custom
// component (which may well render the title) does.
const UI_MODULE_SOURCE_PATTERN = /(?:^|\/)ui\/(?:components\/)?[^/]+$/;

interface DialogSubtreeScan {
  foundTitle: boolean;
  sawOpaqueContent: boolean;
}

const getTrailingNameSegment = (elementName: EsTreeNode): string | null =>
  flattenJsxName(elementName)?.split(".").at(-1) ?? null;

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
  getTrailingNameSegment(elementName) === contract.titleComponent;

const markTitlesInOpaqueExpression = (
  expression: EsTreeNode,
  contract: DialogSurfaceContract,
  context: RuleContext,
  scan: DialogSubtreeScan,
): void => {
  scan.sawOpaqueContent = true;
  // The expression renders content we can't statically enumerate, but any
  // JSX literally written inside it (map callbacks, IIFE branches) is still
  // visible — finding a title there keeps the surrounding report honest.
  walkAst(expression, (node) => {
    if (
      isNodeOfType(node, "JSXOpeningElement") &&
      isTitleElementName(node.name, contract, context)
    ) {
      scan.foundTitle = true;
    }
  });
};

const scanExpressionForTitle = (
  rawExpression: EsTreeNode,
  contract: DialogSurfaceContract,
  context: RuleContext,
  scan: DialogSubtreeScan,
): void => {
  const expression = stripParenExpression(rawExpression);
  if (isNodeOfType(expression, "JSXElement")) {
    scanElementForTitle(expression, contract, context, scan);
    return;
  }
  if (isNodeOfType(expression, "JSXFragment")) {
    scanChildrenForTitle(expression.children, contract, context, scan);
    return;
  }
  if (isNodeOfType(expression, "ConditionalExpression")) {
    scanExpressionForTitle(expression.consequent, contract, context, scan);
    scanExpressionForTitle(expression.alternate, contract, context, scan);
    return;
  }
  if (isNodeOfType(expression, "LogicalExpression")) {
    // `guard && <Jsx/>` renders the right side (the left renders only when
    // falsy, i.e. nothing-ish); `||` / `??` can render either side.
    if (expression.operator !== "&&") {
      scanExpressionForTitle(expression.left, contract, context, scan);
    }
    scanExpressionForTitle(expression.right, contract, context, scan);
    return;
  }
  if (isNodeOfType(expression, "ArrayExpression")) {
    for (const element of expression.elements) {
      if (!element) continue;
      if (isNodeOfType(element, "SpreadElement")) {
        markTitlesInOpaqueExpression(element, contract, context, scan);
      } else {
        scanExpressionForTitle(element, contract, context, scan);
      }
    }
    return;
  }
  if (
    isNodeOfType(expression, "Literal") ||
    isNodeOfType(expression, "TemplateLiteral") ||
    isNodeOfType(expression, "JSXEmptyExpression") ||
    (isNodeOfType(expression, "Identifier") && expression.name === "undefined")
  ) {
    return;
  }
  markTitlesInOpaqueExpression(expression, contract, context, scan);
};

const scanElementForTitle = (
  element: EsTreeNodeOfType<"JSXElement">,
  contract: DialogSurfaceContract,
  context: RuleContext,
  scan: DialogSubtreeScan,
): void => {
  const elementName = element.openingElement.name;
  if (isTitleElementName(elementName, contract, context)) {
    scan.foundTitle = true;
    return;
  }
  const trailingSegment = getTrailingNameSegment(elementName);
  const isCustomComponent =
    trailingSegment !== null && /^[A-Z]/.test(trailingSegment) && trailingSegment !== "Fragment";
  if (
    isCustomComponent &&
    resolveShadcnUiComponentName(elementName, UI_MODULE_SOURCE_PATTERN, context) === null
  ) {
    // An unresolved custom component may render the title itself
    // (`<ConfirmDialogHeader/>`), so a missing-title claim is unprovable.
    // Still recurse: a title nested through it should count.
    scan.sawOpaqueContent = true;
  }
  scanChildrenForTitle(element.children, contract, context, scan);
};

const scanChildrenForTitle = (
  children: ReadonlyArray<EsTreeNode>,
  contract: DialogSurfaceContract,
  context: RuleContext,
  scan: DialogSubtreeScan,
): void => {
  for (const child of children) {
    if (isNodeOfType(child, "JSXElement")) {
      scanElementForTitle(child, contract, context, scan);
    } else if (isNodeOfType(child, "JSXFragment")) {
      scanChildrenForTitle(child.children, contract, context, scan);
    } else if (isNodeOfType(child, "JSXExpressionContainer")) {
      scanExpressionForTitle(child.expression, contract, context, scan);
    }
  }
};

export const shadcnDialogContentRequiresTitle = defineRule({
  id: "shadcn-dialog-content-requires-title",
  title: "Dialog content without a title",
  severity: "warn",
  requires: ["shadcn"],
  recommendation:
    "Give every DialogContent, SheetContent, and AlertDialogContent a matching title part (wrapped in an sr-only element when the design shows no heading) or name the dialog with aria-label.",
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
        const scan: DialogSubtreeScan = { foundTitle: false, sawOpaqueContent: false };
        scanChildrenForTitle(element.children, contract, context, scan);
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
