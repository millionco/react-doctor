import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { isNodeOfType } from "./is-node-of-type.js";

// A JSX event-handler attribute: an `on*` prop whose name is `on` followed by
// an uppercase letter (`onClick`, `onValueChange`). React wires these to
// callback functions, not to data or on/off props.
export const isEventHandlerAttribute = (
  node: EsTreeNode | null | undefined,
): node is EsTreeNodeOfType<"JSXAttribute"> =>
  isNodeOfType(node, "JSXAttribute") &&
  isNodeOfType(node.name, "JSXIdentifier") &&
  /^on[A-Z]/.test(node.name.name);
