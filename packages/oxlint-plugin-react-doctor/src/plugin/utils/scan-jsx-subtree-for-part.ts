import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findJsxAttribute } from "./find-jsx-attribute.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { visitStaticJsxChildren } from "./visit-static-jsx-children.js";
import { walkAst } from "./walk-ast.js";

export interface JsxSubtreePartScanOptions {
  // Whether an element name is the required part (a title, a label, …).
  isPartElementName: (elementName: EsTreeNode) => boolean;
  // Whether an element may render arbitrary content the claim cannot see
  // through (an unresolved custom component). Opaque elements still recurse
  // so a required part nested through them counts.
  isOpaqueElement: (element: EsTreeNodeOfType<"JSXElement">) => boolean;
}

export interface JsxSubtreePartScan {
  foundPart: boolean;
  sawOpaqueContent: boolean;
}

// Scans the statically-visible subtree below `children` for a required part.
// Opaque expressions ({children}, calls) still get a generic deep search —
// parts written inside map callbacks or IIFEs are statically visible even
// when the surrounding expression is not.
export const scanJsxSubtreeForPart = (
  children: ReadonlyArray<EsTreeNode>,
  options: JsxSubtreePartScanOptions,
): JsxSubtreePartScan => {
  const scan: JsxSubtreePartScan = { foundPart: false, sawOpaqueContent: false };
  const findPartInsideExpression = (expression: EsTreeNode): void => {
    walkAst(expression, (node) => {
      if (isNodeOfType(node, "JSXOpeningElement") && options.isPartElementName(node.name)) {
        scan.foundPart = true;
      }
    });
  };
  visitStaticJsxChildren(children, {
    onElement: (element) => {
      if (options.isPartElementName(element.openingElement.name)) {
        scan.foundPart = true;
        return false;
      }
      // Base UI-style composition swaps the rendered element through a
      // `render` prop (`<QuestionnaireTitle render={<DialogTitle />}>`), so
      // a required part written there still counts.
      const renderAttribute = findJsxAttribute(element.openingElement.attributes, "render");
      if (renderAttribute?.value) findPartInsideExpression(renderAttribute.value);
      if (options.isOpaqueElement(element)) scan.sawOpaqueContent = true;
      return true;
    },
    onOpaqueExpression: (expression) => {
      scan.sawOpaqueContent = true;
      findPartInsideExpression(expression);
    },
  });
  return scan;
};
