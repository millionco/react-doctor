import type { SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { unwrapReactHocFunction } from "../../../utils/unwrap-react-hoc-function.js";
import { isInsideR3fWebgpuCanvas } from "./is-inside-r3f-webgpu-canvas.js";
import { isR3fCanvas } from "./is-r3f-canvas.js";

const getLocalComponentSymbol = (
  functionNode: EsTreeNode,
  context: RuleContext,
): SymbolDescriptor | null => {
  if (isNodeOfType(functionNode, "FunctionDeclaration") && functionNode.id) {
    return context.scopes.symbolFor(functionNode.id);
  }
  let current = functionNode.parent ?? null;
  while (current && !isFunctionLike(current)) {
    if (
      isNodeOfType(current, "VariableDeclarator") &&
      isNodeOfType(current.id, "Identifier") &&
      unwrapReactHocFunction(current.init, context.scopes) === functionNode
    ) {
      const componentSymbol = context.scopes.symbolFor(current.id);
      return componentSymbol?.kind === "const" ? componentSymbol : null;
    }
    current = current.parent ?? null;
  }
  return null;
};

const findEnclosingComponentWithoutCanvasBoundary = (
  node: EsTreeNode,
  context: RuleContext,
): EsTreeNode | null => {
  let current = node.parent ?? null;
  while (current) {
    if (isNodeOfType(current, "JSXElement") && isR3fCanvas(current.openingElement, context)) {
      return null;
    }
    if (isFunctionLike(current)) return current;
    current = current.parent ?? null;
  }
  return null;
};

const isLocalComponentRenderedInsideWebgpuCanvas = (
  componentSymbol: SymbolDescriptor,
  context: RuleContext,
  visitedSymbolIds: Set<number>,
): boolean => {
  if (
    visitedSymbolIds.has(componentSymbol.id) ||
    componentSymbol.references.some((reference) => reference.flag !== "read")
  ) {
    return false;
  }

  visitedSymbolIds.add(componentSymbol.id);
  for (const reference of componentSymbol.references) {
    const referenceParent = reference.identifier.parent;
    if (
      !referenceParent ||
      !isNodeOfType(referenceParent, "JSXOpeningElement") ||
      referenceParent.name !== reference.identifier
    ) {
      continue;
    }
    if (isInsideR3fWebgpuCanvas(referenceParent, context)) {
      visitedSymbolIds.delete(componentSymbol.id);
      return true;
    }
    const enclosingComponent = findEnclosingComponentWithoutCanvasBoundary(
      referenceParent,
      context,
    );
    if (!enclosingComponent) continue;
    const enclosingComponentSymbol = getLocalComponentSymbol(enclosingComponent, context);
    if (
      enclosingComponentSymbol &&
      isLocalComponentRenderedInsideWebgpuCanvas(
        enclosingComponentSymbol,
        context,
        visitedSymbolIds,
      )
    ) {
      visitedSymbolIds.delete(componentSymbol.id);
      return true;
    }
  }
  visitedSymbolIds.delete(componentSymbol.id);
  return false;
};

export const isInsideLocalR3fWebgpuComponent = (
  node: EsTreeNode,
  context: RuleContext,
): boolean => {
  let current = node.parent ?? null;
  while (current && !isFunctionLike(current)) current = current.parent ?? null;
  if (!current) return false;
  const componentSymbol = getLocalComponentSymbol(current, context);
  return Boolean(
    componentSymbol &&
    isLocalComponentRenderedInsideWebgpuCanvas(componentSymbol, context, new Set()),
  );
};
