import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { someAst } from "../../../utils/some-ast.js";

export interface NativeJsxPropAttachment {
  readonly field: string;
  readonly propSymbol: SymbolDescriptor;
  readonly openingElement: EsTreeNodeOfType<"JSXOpeningElement">;
  readonly tag: "div" | "nav";
  readonly validatedAncestorWrappers: ReadonlyArray<EsTreeNodeOfType<"JSXOpeningElement">>;
}
export interface NativeJsxAttachmentProofs {
  // Must independently establish that this component merely forwards the exact
  // children, without reading/escaping/replacing their elements or refs.
  readonly isTransparentChildrenWrapper: (
    opening: EsTreeNodeOfType<"JSXOpeningElement">,
    owner: EsTreeNode,
  ) => boolean;
}
const fieldName = (node: EsTreeNode): string | null => {
  if (isNodeOfType(node, "Identifier")) return node.name;
  return isNodeOfType(node, "Literal") && typeof node.value === "string" ? node.value : null;
};
const isHostAncestor = (opening: EsTreeNodeOfType<"JSXOpeningElement">): boolean =>
  isNodeOfType(opening.name, "JSXIdentifier") &&
  new Set(["div", "nav", "span", "section", "main", "aside", "header", "footer"]).has(
    opening.name.name,
  ) &&
  !opening.attributes.some(
    (attribute) =>
      isNodeOfType(attribute, "JSXAttribute") &&
      isNodeOfType(attribute.name, "JSXIdentifier") &&
      attribute.name.name === "is",
  );

/** A cross-module terminal proof only. The caller must resolve the actual
 * component/provider, and close every custom ancestor's child forwarding. */
export const readClosedNativeJsxPropAttachments = (
  program: EsTreeNode,
  component: EsTreeNode,
  requestedFields: ReadonlyArray<string>,
  scopes: ScopeAnalysis,
  proofs?: NativeJsxAttachmentProofs,
): ReadonlyArray<NativeJsxPropAttachment> | null => {
  if (
    program !== scopes.rootScope.node ||
    !isNodeOfType(program, "Program") ||
    !isFunctionLike(component) ||
    component.async ||
    ((isNodeOfType(component, "FunctionDeclaration") ||
      isNodeOfType(component, "FunctionExpression")) &&
      component.generator) ||
    component.params.length !== 1 ||
    requestedFields.length === 0 ||
    new Set(requestedFields).size !== requestedFields.length ||
    !isNodeOfType(component.params[0], "ObjectPattern") ||
    someAst(
      program,
      (node) =>
        isNodeOfType(node, "WithStatement") ||
        (isNodeOfType(node, "Identifier") && node.name === "eval"),
    )
  )
    return null;
  const properties = component.params[0].properties;
  const names = new Set<string>();
  for (const property of properties) {
    if (
      !isNodeOfType(property, "Property") ||
      property.computed ||
      property.method ||
      property.kind !== "init"
    )
      return null;
    const key = fieldName(property.key);
    if (key === null || names.has(key)) return null;
    names.add(key);
  }
  const result: NativeJsxPropAttachment[] = [];
  for (const field of requestedFields) {
    const property = properties.find(
      (candidate) => isNodeOfType(candidate, "Property") && fieldName(candidate.key) === field,
    );
    if (!isNodeOfType(property, "Property") || !isNodeOfType(property.value, "Identifier"))
      return null;
    const binding = scopes.symbolFor(property.value);
    if (
      !binding ||
      binding.bindingIdentifier !== property.value ||
      !hasCompleteSymbolReferences(binding, program, scopes) ||
      binding.references.length !== 1
    )
      return null;
    const reference = binding.references[0];
    if (reference.flag !== "read" || findEnclosingFunction(reference.identifier) !== component)
      return null;
    const value = findTransparentExpressionRoot(reference.identifier);
    const container = value.parent;
    const attribute = container?.parent;
    const opening = attribute?.parent;
    if (
      !isNodeOfType(container, "JSXExpressionContainer") ||
      container.expression !== value ||
      !isNodeOfType(attribute, "JSXAttribute") ||
      attribute.value !== container ||
      !isNodeOfType(attribute.name, "JSXIdentifier") ||
      attribute.name.name !== "ref" ||
      !isNodeOfType(opening, "JSXOpeningElement") ||
      !isNodeOfType(opening.name, "JSXIdentifier") ||
      (opening.name.name !== "div" && opening.name.name !== "nav") ||
      opening.attributes.some((item) => isNodeOfType(item, "JSXSpreadAttribute")) ||
      opening.attributes.filter(
        (item) =>
          isNodeOfType(item, "JSXAttribute") &&
          isNodeOfType(item.name, "JSXIdentifier") &&
          item.name.name === "ref",
      ).length !== 1 ||
      opening.attributes.some(
        (item) =>
          isNodeOfType(item, "JSXAttribute") &&
          isNodeOfType(item.name, "JSXIdentifier") &&
          (item.name.name === "is" || item.name.name === "as"),
      )
    )
      return null;
    const wrappers: Array<EsTreeNodeOfType<"JSXOpeningElement">> = [];
    let cursor: EsTreeNode = opening.parent!;
    if (!isNodeOfType(cursor, "JSXElement")) return null;
    let reachesReturn = false;
    while (cursor.parent && cursor.parent !== component) {
      const parent: EsTreeNode | null | undefined = cursor.parent;
      if (isFunctionLike(parent)) return null;
      if (isNodeOfType(parent, "ReturnStatement")) {
        if (parent.argument !== cursor) return null;
        reachesReturn = true;
      }
      if (isNodeOfType(parent, "ExpressionStatement")) return null;
      if (isNodeOfType(parent, "LogicalExpression") && parent.right !== cursor) return null;
      if (isNodeOfType(parent, "ConditionalExpression") && parent.test === cursor) return null;
      if (
        isNodeOfType(parent, "BinaryExpression") ||
        isNodeOfType(parent, "UnaryExpression") ||
        isNodeOfType(parent, "SequenceExpression") ||
        isNodeOfType(parent, "AwaitExpression") ||
        isNodeOfType(parent, "YieldExpression")
      )
        return null;
      if (isNodeOfType(parent, "JSXAttribute") || isNodeOfType(parent, "JSXSpreadAttribute"))
        return null; // An element passed as a named prop is not children forwarding.
      if (isNodeOfType(parent, "JSXElement")) {
        const ancestor = parent.openingElement;
        if (!isHostAncestor(ancestor)) {
          if (!proofs?.isTransparentChildrenWrapper(ancestor, component)) return null;
          wrappers.push(ancestor);
        }
      }
      // Do not permit constructing/storing/passing the element through arbitrary
      // calls or variable aliases before it reaches this function's return.
      if (
        isNodeOfType(parent, "CallExpression") ||
        isNodeOfType(parent, "VariableDeclarator") ||
        isNodeOfType(parent, "AssignmentExpression") ||
        isNodeOfType(parent, "ArrayExpression") ||
        isNodeOfType(parent, "ObjectExpression")
      )
        return null;
      cursor = parent;
    }
    if (
      cursor.parent !== component ||
      (!reachesReturn &&
        (isNodeOfType(component.body, "BlockStatement") || component.body !== cursor))
    )
      return null;
    result.push({
      field,
      propSymbol: binding,
      openingElement: opening,
      tag: opening.name.name,
      validatedAncestorWrappers: wrappers,
    });
  }
  return result;
};
