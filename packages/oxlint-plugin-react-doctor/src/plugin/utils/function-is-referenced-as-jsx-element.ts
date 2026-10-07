import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getFunctionBindingSymbols } from "./get-function-binding-symbols.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const functionIsReferencedAsJsxElement = (
  functionNode: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean =>
  getFunctionBindingSymbols(functionNode, scopes).some((symbol) =>
    symbol.references.some((reference) => {
      const referenceNode = reference.identifier;
      const parentNode = referenceNode.parent;
      return Boolean(
        isNodeOfType(referenceNode, "JSXIdentifier") &&
        parentNode &&
        isNodeOfType(parentNode, "JSXOpeningElement") &&
        parentNode.name === referenceNode,
      );
    }),
  );
