import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { isJsxFragmentElement } from "./is-jsx-fragment-element.js";
import { isNodeOfType } from "./is-node-of-type.js";

const NATIVE_JSX_NAME_PATTERN = /^[a-z][a-z0-9]*$/;

const getMapResult = (callback: EsTreeNode): EsTreeNode | null => {
  if (!isNodeOfType(callback, "ArrowFunctionExpression") || callback.async) return null;
  const call = callback.parent;
  return isNodeOfType(call, "CallExpression") &&
    !call.optional &&
    call.arguments.length === 1 &&
    call.arguments[0] === callback &&
    isNodeOfType(call.callee, "MemberExpression") &&
    !call.callee.optional &&
    getStaticPropertyKeyName(call.callee) === "map"
    ? call
    : null;
};

export const isDirectJsxRenderChild = (
  opening: EsTreeNodeOfType<"JSXOpeningElement">,
  scopes: ScopeAnalysis,
): boolean => {
  const value = opening.parent;
  if (!isNodeOfType(value, "JSXElement")) return false;
  let current: EsTreeNode = value;
  let isInsideFragment = false;
  while (true) {
    current = findTransparentExpressionRoot(current);
    const parent = current.parent;
    if (isNodeOfType(parent, "JSXFragment")) {
      if (!parent.children.some((child) => child === current)) return false;
      isInsideFragment = true;
      current = parent;
      continue;
    }
    if (isNodeOfType(parent, "JSXElement")) {
      if (!parent.children.some((child) => child === current)) return false;
      if (isJsxFragmentElement(parent.openingElement, scopes)) {
        isInsideFragment = true;
        current = parent;
        continue;
      }
      const name = parent.openingElement.name;
      return isNodeOfType(name, "JSXIdentifier") && NATIVE_JSX_NAME_PATTERN.test(name.name);
    }
    if (
      (isNodeOfType(parent, "JSXExpressionContainer") && parent.expression === current) ||
      (isNodeOfType(parent, "ConditionalExpression") &&
        (parent.consequent === current || parent.alternate === current)) ||
      (isNodeOfType(parent, "LogicalExpression") && parent.right === current)
    ) {
      current = parent;
      continue;
    }
    let callback: EsTreeNode | null = null;
    if (isNodeOfType(parent, "ArrowFunctionExpression") && parent.body === current)
      callback = parent;
    if (isNodeOfType(parent, "ReturnStatement") && parent.argument === current)
      callback = findEnclosingFunction(parent);
    const map = callback && getMapResult(callback);
    if (!map)
      return (
        isInsideFragment &&
        (isNodeOfType(callback, "FunctionDeclaration") ||
          (isNodeOfType(callback, "ArrowFunctionExpression") &&
            isNodeOfType(callback.parent, "VariableDeclarator") &&
            callback.parent.init === callback))
      );
    current = map;
  }
};
