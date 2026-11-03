import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export const hasNoOpaqueReactRef = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const isAbsentRef = (expression: EsTreeNode | null | undefined): boolean => {
    if (!expression) return true;
    const value = stripParenExpression(expression);
    return (
      (isNodeOfType(value, "Literal") && value.value === null) ||
      (isNodeOfType(value, "Identifier") &&
        value.name === "undefined" &&
        scopes.isGlobalReference(value))
    );
  };
  if (isNodeOfType(node, "JSXOpeningElement")) {
    return node.attributes.every((attribute) => {
      if (!isNodeOfType(attribute, "JSXAttribute")) return false;
      if (!isNodeOfType(attribute.name, "JSXIdentifier")) return false;
      if (attribute.name.name !== "ref") return true;
      return (
        isNodeOfType(attribute.value, "JSXExpressionContainer") &&
        isAbsentRef(attribute.value.expression)
      );
    });
  }
  if (!isNodeOfType(node, "CallExpression")) return false;
  const [, props] = node.arguments;
  if (isAbsentRef(props)) return true;
  if (!props) return true;
  const value = stripParenExpression(props);
  if (!isNodeOfType(value, "ObjectExpression")) return false;
  return value.properties.every((property) => {
    if (
      !isNodeOfType(property, "Property") ||
      property.computed ||
      property.method ||
      property.kind !== "init"
    )
      return false;
    const name = getStaticPropertyKeyName(property);
    return Boolean(name && name !== "__proto__" && (name !== "ref" || isAbsentRef(property.value)));
  });
};
