import { collectPatternNames } from "../../../utils/collect-pattern-names.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { getJsxAttributeName } from "../../../utils/get-jsx-attribute-name.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isPropertyNamePosition } from "../../../utils/is-property-name-position.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { isEventHandlerName } from "./event-handler-reference.js";

// Own-scope bound names (params + non-nested declarators) per function node,
// memoized so the repeated "does this nested function declare X" checks are
// a Set lookup instead of a fresh subtree walk each time.
const ownScopeBoundNamesCache = new WeakMap<EsTreeNode, ReadonlySet<string>>();

const getOwnScopeBoundNames = (functionNode: EsTreeNode): ReadonlySet<string> => {
  const cached = ownScopeBoundNamesCache.get(functionNode);
  if (cached) return cached;
  const boundNames = new Set<string>();
  if (isFunctionLike(functionNode)) {
    for (const param of functionNode.params ?? []) collectPatternNames(param, boundNames);
  }
  walkAst(functionNode, (child: EsTreeNode): boolean | void => {
    if (child !== functionNode && isFunctionLike(child)) return false;
    if (isNodeOfType(child, "VariableDeclarator")) {
      collectPatternNames(child.id, boundNames);
    }
  });
  ownScopeBoundNamesCache.set(functionNode, boundNames);
  return boundNames;
};

const declaresBindingNamed = (functionNode: EsTreeNode, bindingName: string): boolean =>
  getOwnScopeBoundNames(functionNode).has(bindingName);

export const referencesIdentifierNamed = (root: EsTreeNode, identifierName: string): boolean => {
  let isReferenced = false;
  walkAst(root, (child: EsTreeNode): boolean | void => {
    if (isReferenced) return false;
    if (child !== root && isFunctionLike(child) && declaresBindingNamed(child, identifierName)) {
      return false;
    }
    if (
      isNodeOfType(child, "Identifier") &&
      child.name === identifierName &&
      !isPropertyNamePosition(child)
    ) {
      isReferenced = true;
      return false;
    }
  });
  return isReferenced;
};

export const isSetterWiredToJsxHandler = (
  componentFunction: EsTreeNode,
  setterName: string,
  matchesAttribute: (attribute: EsTreeNode) => boolean = () => true,
): boolean => {
  let isWired = false;
  walkAst(componentFunction, (child: EsTreeNode): boolean | void => {
    if (isWired) return false;
    if (
      child !== componentFunction &&
      isFunctionLike(child) &&
      declaresBindingNamed(child, setterName)
    ) {
      return false;
    }
    if (!isNodeOfType(child, "JSXAttribute") || !child.value || !matchesAttribute(child)) return;
    const attributeName = getJsxAttributeName(child.name);
    if (!attributeName || !isEventHandlerName(attributeName)) return;
    if (referencesIdentifierNamed(child.value, setterName)) {
      isWired = true;
      return false;
    }
  });
  return isWired;
};
