import type { Reference } from "eslint-scope";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { getFunctionBindingIdentifier } from "../../../utils/get-function-binding-name.js";
import { getJsxAttributeName } from "../../../utils/get-jsx-attribute-name.js";
import { isAstDescendant } from "../../../utils/is-ast-descendant.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { RuleContext } from "../../../utils/rule-context.js";

const EXTERNAL_RESOURCE_EVENT_ATTRIBUTE_NAMES: ReadonlySet<string> = new Set([
  "onAbort",
  "onCanPlay",
  "onCanPlayThrough",
  "onEmptied",
  "onError",
  "onLoad",
  "onLoadedData",
  "onLoadedMetadata",
  "onStalled",
  "onSuspend",
]);

const getContainingJsxAttributeName = (node: EsTreeNode): string | null => {
  const expression = findTransparentExpressionRoot(node);
  const expressionContainer = expression.parent;
  if (
    !isNodeOfType(expressionContainer, "JSXExpressionContainer") ||
    expressionContainer.expression !== expression
  ) {
    return null;
  }
  const attribute = expressionContainer.parent;
  return isNodeOfType(attribute, "JSXAttribute") ? getJsxAttributeName(attribute.name) : null;
};

const functionIsExternalResourceHandler = (
  functionNode: EsTreeNode,
  context: RuleContext,
): boolean => {
  const bindingIdentifier = getFunctionBindingIdentifier(functionNode);
  if (!bindingIdentifier) return false;
  const symbol = context.scopes.symbolFor(bindingIdentifier);
  return Boolean(
    symbol?.references.some((reference) => {
      const attributeName = getContainingJsxAttributeName(reference.identifier);
      return attributeName !== null && EXTERNAL_RESOURCE_EVENT_ATTRIBUTE_NAMES.has(attributeName);
    }),
  );
};

export const hasExternalResourceSetterWriter = (
  context: RuleContext,
  setterReference: Reference,
  effectNode: EsTreeNode,
): boolean => {
  const componentFunction = findEnclosingFunction(effectNode);
  if (!componentFunction || !setterReference.resolved) return false;
  for (const reference of setterReference.resolved.references) {
    if (reference.init) continue;
    const identifier = reference.identifier as unknown as EsTreeNode;
    if (isAstDescendant(identifier, effectNode)) continue;
    const directAttributeName = getContainingJsxAttributeName(identifier);
    if (
      directAttributeName !== null &&
      EXTERNAL_RESOURCE_EVENT_ATTRIBUTE_NAMES.has(directAttributeName)
    ) {
      return true;
    }
    let writerFunction = findEnclosingFunction(identifier);
    while (writerFunction && writerFunction !== componentFunction) {
      const writerAttributeName = getContainingJsxAttributeName(writerFunction);
      if (
        (writerAttributeName !== null &&
          EXTERNAL_RESOURCE_EVENT_ATTRIBUTE_NAMES.has(writerAttributeName)) ||
        functionIsExternalResourceHandler(writerFunction, context)
      ) {
        return true;
      }
      const parentNode = writerFunction.parent;
      writerFunction = parentNode ? findEnclosingFunction(parentNode) : null;
    }
  }
  return false;
};
