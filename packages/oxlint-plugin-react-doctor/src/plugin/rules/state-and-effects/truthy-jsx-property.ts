import { type ScopeAnalysis } from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { getJsxAttributeName } from "../../utils/get-jsx-attribute-name.js";
import { hasCompleteSymbolReferences } from "../../utils/has-complete-symbol-references.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { getImportDeclarationForSymbol } from "../../utils/get-import-declaration-for-symbol.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";

export const hasReactSuspense = (opening: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (
    !isNodeOfType(opening, "JSXOpeningElement") ||
    !isNodeOfType(opening.name, "JSXIdentifier") ||
    opening.attributes.length !== 1
  )
    return false;
  const wrapper = scopes.symbolFor(opening.name);
  const declaration = wrapper ? getImportDeclarationForSymbol(wrapper) : null;
  const specifier = wrapper?.declarationNode;
  const [attribute] = opening.attributes;
  return (
    declaration?.source.value === "react" &&
    declaration.importKind !== "type" &&
    isNodeOfType(specifier, "ImportSpecifier") &&
    specifier.importKind !== "type" &&
    isNodeOfType(specifier.imported, "Identifier") &&
    specifier.imported.name === "Suspense" &&
    isNodeOfType(attribute, "JSXAttribute") &&
    getJsxAttributeName(attribute.name) === "fallback" &&
    isNodeOfType(attribute.value, "JSXExpressionContainer") &&
    isNodeOfType(attribute.value.expression, "Literal") &&
    attribute.value.expression.value === null
  );
};

const requiresTruthyBinding = (
  condition: EsTreeNode,
  binding: NonNullable<ReturnType<ScopeAnalysis["symbolFor"]>>,
  scopes: ScopeAnalysis,
): boolean => {
  const node = stripParenExpression(condition);
  if (isNodeOfType(node, "Identifier")) return scopes.symbolFor(node) === binding;
  return (
    isNodeOfType(node, "LogicalExpression") &&
    node.operator === "&&" &&
    (requiresTruthyBinding(node.left, binding, scopes) ||
      requiresTruthyBinding(node.right, binding, scopes))
  );
};

export const isTruthyJsxProperty = (
  opening: EsTreeNode,
  property: string,
  program: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (
    !isNodeOfType(opening, "JSXOpeningElement") ||
    ["children", "ref", "key", "__source", "__self", "__proto__"].includes(property)
  )
    return false;
  if (opening.attributes.some((attribute) => !isNodeOfType(attribute, "JSXAttribute"))) {
    return false;
  }
  const matches = opening.attributes.filter(
    (attribute) =>
      isNodeOfType(attribute, "JSXAttribute") && getJsxAttributeName(attribute.name) === property,
  );
  const [attribute] = matches;
  if (matches.length !== 1 || !isNodeOfType(attribute, "JSXAttribute")) return false;
  if (!attribute.value) return true;
  if (!isNodeOfType(attribute.value, "JSXExpressionContainer")) return false;
  const value = stripParenExpression(attribute.value.expression as EsTreeNode);
  if (isNodeOfType(value, "Literal")) return value.value === true;
  if (!isNodeOfType(value, "Identifier")) return false;
  const binding = scopes.symbolFor(value);
  if (
    binding?.kind !== "const" ||
    binding.references.some(({ flag }) => flag !== "read") ||
    !hasCompleteSymbolReferences(binding, program, scopes)
  )
    return false;
  const element = opening.parent;
  if (!isNodeOfType(element, "JSXElement")) return false;
  let current: EsTreeNode = element;
  while (current.parent) {
    const parent: EsTreeNode = current.parent;
    if (
      isNodeOfType(parent, "LogicalExpression") &&
      parent.operator === "&&" &&
      parent.right === current
    ) {
      if (requiresTruthyBinding(parent.left, binding, scopes)) return true;
    } else if (
      isNodeOfType(parent, "JSXElement") &&
      parent.children.some((candidate) => candidate === current) &&
      hasReactSuspense(parent.openingElement, scopes)
    ) {
      // The provider proof must separately establish React's actual Suspense implementation.
    } else if (
      isNodeOfType(parent, "JSXFragment") &&
      parent.children.some((candidate) => candidate === current)
    ) {
      // JSX fragments only group their children under the selected stock transform.
    } else if (
      (isNodeOfType(parent, "JSXExpressionContainer") ||
        String(parent.type) === "ParenthesizedExpression") &&
      "expression" in parent &&
      parent.expression === current
    ) {
      // The expression still evaluates in its original lexical scope.
    } else {
      return false;
    }
    current = parent;
  }
  return false;
};
