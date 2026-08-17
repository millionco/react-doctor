import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import { getIconLibraryFamily } from "../../utils/get-icon-library-family.js";
import { getJsxPropStringValue } from "../../utils/get-jsx-prop-string-value.js";
import { getJsxPropStaticStringValues } from "../../utils/get-jsx-prop-static-string-values.js";
import { getTrailingJsxNameSegment } from "../../utils/get-trailing-jsx-name-segment.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import { isHiddenFromScreenReader } from "../../utils/is-hidden-from-screen-reader.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isTypeOnlyImport } from "../../utils/is-type-only-import.js";
import { jsxAttributeMayHaveNonEmptyValue } from "../../utils/jsx-attribute-may-have-non-empty-value.js";
import { readStaticBoolean } from "../../utils/read-static-boolean.js";
import { resolveConstIdentifierAlias } from "../../utils/resolve-const-identifier-alias.js";
import { resolveShadcnUiComponentName } from "../../utils/resolve-shadcn-ui-component-name.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { visitStaticJsxChildren } from "../../utils/visit-static-jsx-children.js";

const BUTTON_MODULE_PATTERN = /(?:^|\/)ui\/(?:.*\/)?button$|^\.\.?\/(?:.*\/)?button$/;
const ICON_SIZE_PREFIX = "icon";
const ICON_COMPONENT_NAME_PATTERN = /(?:Icon$|^Icon(?:[A-Z0-9]|$)|^Spinner|^Loader)/;
const NAME_PROVIDING_ATTRIBUTES = ["aria-label", "aria-labelledby", "title"] as const;

const isIconLibraryImport = (elementName: EsTreeNode, context: RuleContext): boolean => {
  const rootIdentifier = isNodeOfType(elementName, "JSXMemberExpression")
    ? elementName.object
    : elementName;
  if (!isNodeOfType(rootIdentifier, "JSXIdentifier")) return false;
  const symbol = resolveConstIdentifierAlias(rootIdentifier, context.scopes);
  if (!symbol || symbol.kind !== "import") return false;
  const declaration = symbol.declarationNode.parent;
  if (
    !declaration ||
    !isNodeOfType(declaration, "ImportDeclaration") ||
    isTypeOnlyImport(declaration)
  ) {
    return false;
  }
  const source = declaration.source.value;
  return typeof source === "string" && getIconLibraryFamily(source) !== null;
};

// Icons contribute no accessible name: intrinsic `svg` (a nested `<title>`
// still surfaces through the text walk), icon-library imports, and
// Icon/Spinner/Loader-named components.
const isIconElement = (elementName: EsTreeNode, context: RuleContext): boolean => {
  const trailingSegment = getTrailingJsxNameSegment(elementName);
  if (trailingSegment === "svg") return false;
  return (
    (trailingSegment !== null && ICON_COMPONENT_NAME_PATTERN.test(trailingSegment)) ||
    isIconLibraryImport(elementName, context)
  );
};

interface IconButtonContentScan {
  hasAccessibleText: boolean;
  hasUnprovableContent: boolean;
}

const isInsideJsxAttribute = (node: EsTreeNode): boolean => {
  let ancestor: EsTreeNode | null | undefined = node.parent;
  while (ancestor) {
    if (isNodeOfType(ancestor, "JSXAttribute")) return true;
    ancestor = ancestor.parent;
  }
  return false;
};

const scanButtonContent = (
  buttonElement: EsTreeNodeOfType<"JSXElement">,
  context: RuleContext,
): IconButtonContentScan => {
  const scan: IconButtonContentScan = { hasAccessibleText: false, hasUnprovableContent: false };
  visitStaticJsxChildren(buttonElement.children, {
    onElement: (element) => {
      const openingElement = element.openingElement;
      if (isHiddenFromScreenReader(openingElement, context.settings)) return false;
      if (
        NAME_PROVIDING_ATTRIBUTES.some((attribute) =>
          jsxAttributeMayHaveNonEmptyValue(
            hasJsxPropIgnoreCase(openingElement.attributes, attribute),
            { scopes: context.scopes },
          ),
        )
      ) {
        scan.hasAccessibleText = true;
        return false;
      }
      const elementName = openingElement.name;
      if (isIconElement(elementName, context)) return false;
      const trailingSegment = getTrailingJsxNameSegment(elementName);
      if (trailingSegment === "img") {
        if (
          jsxAttributeMayHaveNonEmptyValue(hasJsxPropIgnoreCase(openingElement.attributes, "alt"), {
            scopes: context.scopes,
          })
        ) {
          scan.hasAccessibleText = true;
        }
        return false;
      }
      const isCustomComponent = trailingSegment !== null && /^[A-Z]/.test(trailingSegment);
      if (isCustomComponent && trailingSegment !== "Fragment") {
        // A non-icon custom component may render label text.
        scan.hasUnprovableContent = true;
      }
      return true;
    },
    onOpaqueExpression: () => {
      scan.hasUnprovableContent = true;
    },
    onStaticText: () => {
      scan.hasAccessibleText = true;
    },
  });
  return scan;
};

export const shadcnIconButtonRequiresLabel = defineRule({
  id: "shadcn-icon-button-requires-label",
  title: "Icon-only Button without accessible name",
  severity: "warn",
  requires: ["shadcn"],
  recommendation:
    "Give every icon-sized Button an aria-label or an sr-only text child so assistive technology announces what the button does.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (resolveShadcnUiComponentName(node.name, BUTTON_MODULE_PATTERN, context) !== "Button") {
        return;
      }
      // A spread can supply aria-label; asChild delegates semantics (and
      // often the name) to the slotted child; a react-aria `slot` lets the
      // surrounding component wire a default accessible name (the TagGroup
      // remove slot announces "Remove").
      if (hasJsxSpreadAttribute(node.attributes)) return;
      const asChildAttribute = findJsxAttribute(node.attributes, "asChild");
      if (asChildAttribute) {
        if (!asChildAttribute.value) return;
        if (!isNodeOfType(asChildAttribute.value, "JSXExpressionContainer")) return;
        if (readStaticBoolean(asChildAttribute.value.expression) !== false) return;
      }
      const slotAttribute = findJsxAttribute(node.attributes, "slot");
      if (slotAttribute) {
        const slotValue = getJsxPropStringValue(slotAttribute);
        if (slotValue === null || slotValue === "remove") return;
      }
      if (
        NAME_PROVIDING_ATTRIBUTES.some((attribute) =>
          jsxAttributeMayHaveNonEmptyValue(hasJsxPropIgnoreCase(node.attributes, attribute), {
            scopes: context.scopes,
          }),
        )
      ) {
        return;
      }
      const sizeAttribute = findJsxAttribute(node.attributes, "size");
      if (!sizeAttribute) return;
      const sizeValues = getJsxPropStaticStringValues(sizeAttribute, context.scopes);
      if (
        !sizeValues ||
        sizeValues.length === 0 ||
        !sizeValues.every((sizeValue) => sizeValue.startsWith(ICON_SIZE_PREFIX))
      ) {
        return;
      }
      // A Button passed through an attribute (`render={<Button size="icon" />}`,
      // Base UI / react-aria composition) receives its children — including
      // any sr-only label — from the wrapping component, so its content is
      // not statically knowable here.
      if (isInsideJsxAttribute(node)) return;
      const buttonElement = node.parent;
      const scan =
        buttonElement && isNodeOfType(buttonElement, "JSXElement")
          ? scanButtonContent(buttonElement, context)
          : { hasAccessibleText: false, hasUnprovableContent: false };
      if (scan.hasAccessibleText || scan.hasUnprovableContent) return;
      context.report({
        node: node.name,
        message:
          'This icon-only Button has no accessible name, so screen readers announce an unnamed button. Add aria-label or an sr-only text child (e.g. <span className="sr-only">Delete</span>).',
      });
    },
  }),
});
