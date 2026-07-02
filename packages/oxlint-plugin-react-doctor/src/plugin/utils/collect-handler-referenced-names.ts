import { REACT_HANDLER_PROP_PATTERN } from "../constants/react.js";
import { collectReferenceIdentifierNames } from "./collect-reference-identifier-names.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { walkAst } from "./walk-ast.js";

// A call in handler position (`onClick={makeHandler()}`) runs DURING render,
// so its callee is not a deferred handler — only the values it receives may
// be. Member-expression callees (`handleClick.bind(null)`) keep collecting
// their object, which the bound function defers.
const collectDeferredHandlerValueNames = (
  valueNode: EsTreeNode | null | undefined,
  names: Set<string>,
): void => {
  if (!valueNode) return;
  if (isNodeOfType(valueNode, "JSXExpressionContainer")) {
    collectDeferredHandlerValueNames(valueNode.expression, names);
    return;
  }
  if (isNodeOfType(valueNode, "CallExpression")) {
    if (!isNodeOfType(valueNode.callee, "Identifier")) {
      collectDeferredHandlerValueNames(valueNode.callee, names);
    }
    for (const callArgument of valueNode.arguments ?? []) {
      collectDeferredHandlerValueNames(callArgument, names);
    }
    return;
  }
  collectReferenceIdentifierNames(valueNode, names);
};

// Names referenced by any JSX `onXxx` attribute value (`onClick={goHome}`) or
// `onXxx` object property — functions wired up as event handlers, so they run
// on interaction rather than during render.
export const collectHandlerReferencedNames = (root: EsTreeNode): Set<string> => {
  const names = new Set<string>();
  walkAst(root, (node: EsTreeNode) => {
    if (
      isNodeOfType(node, "JSXAttribute") &&
      isNodeOfType(node.name, "JSXIdentifier") &&
      REACT_HANDLER_PROP_PATTERN.test(node.name.name) &&
      node.value
    ) {
      collectDeferredHandlerValueNames(node.value, names);
      return;
    }
    if (
      isNodeOfType(node, "Property") &&
      ((isNodeOfType(node.key, "Identifier") && REACT_HANDLER_PROP_PATTERN.test(node.key.name)) ||
        (isNodeOfType(node.key, "Literal") &&
          typeof node.key.value === "string" &&
          REACT_HANDLER_PROP_PATTERN.test(node.key.value)))
    ) {
      collectDeferredHandlerValueNames(node.value, names);
    }
  });
  return names;
};
