import type { EsTreeNode } from "./es-tree-node.js";
import { getFunctionBindingName } from "./get-function-binding-name.js";
import { hasCapability } from "./get-react-doctor-setting.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { isFrameworkRouteOrSpecialFilename } from "./is-framework-route-or-special-filename.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isStaticReactRouterRouteObject } from "./is-static-react-router-route-object.js";
import type { RuleContext } from "./rule-context.js";

export const isReactRouterRouteFunction = (
  context: RuleContext,
  functionNode: EsTreeNode,
  expectedName: string,
): boolean => {
  if (!isFunctionLike(functionNode)) return false;
  const parent = functionNode.parent;
  if (
    isNodeOfType(parent, "Property") &&
    parent.value === functionNode &&
    getStaticPropertyKeyName(parent, { allowComputedString: true }) === expectedName &&
    isNodeOfType(parent.parent, "ObjectExpression") &&
    isStaticReactRouterRouteObject(context, parent.parent)
  ) {
    return true;
  }
  if (getFunctionBindingName(functionNode) !== expectedName) return false;
  if (!hasCapability(context.settings, "react-router-framework")) return false;
  if (!isFrameworkRouteOrSpecialFilename(context, "react-router")) return false;

  let declaration: EsTreeNode | null | undefined = functionNode;
  while (declaration !== null && declaration !== undefined) {
    if (isNodeOfType(declaration.parent, "ExportNamedDeclaration")) return true;
    if (
      !isNodeOfType(declaration.parent, "VariableDeclarator") &&
      !isNodeOfType(declaration.parent, "VariableDeclaration")
    ) {
      return false;
    }
    declaration = declaration.parent;
  }
  return false;
};
