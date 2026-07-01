import { REACT_HANDLER_PROP_PATTERN } from "../constants/react.js";
import { collectReferenceIdentifierNames } from "./collect-reference-identifier-names.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { walkAst } from "./walk-ast.js";

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
      collectReferenceIdentifierNames(node.value, names);
      return;
    }
    if (
      isNodeOfType(node, "Property") &&
      ((isNodeOfType(node.key, "Identifier") && REACT_HANDLER_PROP_PATTERN.test(node.key.name)) ||
        (isNodeOfType(node.key, "Literal") &&
          typeof node.key.value === "string" &&
          REACT_HANDLER_PROP_PATTERN.test(node.key.value)))
    ) {
      collectReferenceIdentifierNames(node.value, names);
    }
  });
  return names;
};
