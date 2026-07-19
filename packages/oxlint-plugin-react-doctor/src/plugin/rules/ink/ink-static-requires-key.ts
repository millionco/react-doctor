import { MINIMUM_INK_VERSIONS } from "../../constants/ink.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { hasJsxKeyAttribute } from "../../utils/has-jsx-key-attribute.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveInkJsxElementName } from "../../utils/resolve-ink-api-name.js";
import { walkAst } from "../../utils/walk-ast.js";

const collectReturnedElements = (renderFunction: EsTreeNode): EsTreeNodeOfType<"JSXElement">[] => {
  if (
    (isNodeOfType(renderFunction, "ArrowFunctionExpression") ||
      isNodeOfType(renderFunction, "FunctionExpression")) &&
    isNodeOfType(renderFunction.body, "JSXElement")
  ) {
    return [renderFunction.body];
  }
  if (
    (!isNodeOfType(renderFunction, "ArrowFunctionExpression") &&
      !isNodeOfType(renderFunction, "FunctionExpression")) ||
    !isNodeOfType(renderFunction.body, "BlockStatement")
  ) {
    return [];
  }
  const returnedElements: EsTreeNodeOfType<"JSXElement">[] = [];
  walkAst(renderFunction.body, (descendantNode) => {
    if (descendantNode !== renderFunction.body && /Function/.test(descendantNode.type))
      return false;
    if (
      isNodeOfType(descendantNode, "ReturnStatement") &&
      isNodeOfType(descendantNode.argument, "JSXElement")
    ) {
      returnedElements.push(descendantNode.argument);
    }
  });
  return returnedElements;
};

export const inkStaticRequiresKey = defineRule({
  id: "ink-static-requires-key",
  title: "Static item root missing a key",
  severity: "error",
  minimumInkVersion: MINIMUM_INK_VERSIONS.base,
  recommendation: "Put a stable `key` on the root element returned by `<Static>`.",
  create: (context) => ({
    JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
      if (resolveInkJsxElementName(node.openingElement, context.scopes) !== "Static") return;
      for (const childNode of node.children) {
        if (!isNodeOfType(childNode, "JSXExpressionContainer")) continue;
        const renderFunction = childNode.expression;
        for (const returnedElement of collectReturnedElements(renderFunction)) {
          if (hasJsxKeyAttribute(returnedElement.openingElement)) continue;
          context.report({
            node: returnedElement.openingElement,
            message: "The root element returned by `<Static>` needs a `key`.",
          });
        }
      }
    },
  }),
});
