import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getImportDeclarationForSymbol } from "./get-import-declaration-for-symbol.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isKeyedDraftTypeReference } from "./is-keyed-draft-type-reference.js";
import { walkAst } from "./walk-ast.js";

interface SymbolReferenceIndex {
  readonly resolvedNodes: Map<SymbolDescriptor, EsTreeNodeOfType<"Identifier" | "JSXIdentifier">[]>;
  readonly ambiguousNodes: Map<string, EsTreeNodeOfType<"Identifier" | "JSXIdentifier">[]>;
  readonly completeness: Map<SymbolDescriptor, boolean>;
}

const indexesByScopes = new WeakMap<ScopeAnalysis, WeakMap<EsTreeNode, SymbolReferenceIndex>>();

const isNonReferenceName = (node: EsTreeNode): boolean => {
  const parent = node.parent;
  if (!parent) return false;
  if (isNodeOfType(parent, "MemberExpression")) return parent.property === node && !parent.computed;
  if (isNodeOfType(parent, "Property")) {
    return parent.key === node && !parent.computed && (!parent.shorthand || parent.value !== node);
  }
  if (isNodeOfType(parent, "MethodDefinition") || isNodeOfType(parent, "PropertyDefinition")) {
    return parent.key === node && !parent.computed;
  }
  if (isNodeOfType(parent, "JSXAttribute")) return parent.name === node;
  if (isNodeOfType(parent, "JSXMemberExpression")) return parent.property === node;
  if (isNodeOfType(parent, "ImportSpecifier"))
    return parent.imported === node && parent.local !== node;
  if (isNodeOfType(parent, "ExportSpecifier"))
    return parent.exported === node && parent.local !== node;
  if (
    isNodeOfType(parent, "LabeledStatement") ||
    isNodeOfType(parent, "BreakStatement") ||
    isNodeOfType(parent, "ContinueStatement")
  )
    return parent.label === node;
  return (
    isNodeOfType(node, "JSXIdentifier") &&
    /^[a-z]/.test(node.name) &&
    (isNodeOfType(parent, "JSXOpeningElement") || isNodeOfType(parent, "JSXClosingElement")) &&
    parent.name === node
  );
};

const hasRuntimeTypeScriptAncestor = (node: EsTreeNode): boolean => {
  let ancestor = node.parent;
  while (ancestor?.type.startsWith("TS")) {
    if (
      ancestor.type === "TSParameterProperty" ||
      ancestor.type === "TSImportEqualsDeclaration" ||
      ancestor.type === "TSExportAssignment" ||
      ancestor.type === "TSEnumMember" ||
      ancestor.type === "TSEnumDeclaration" ||
      ancestor.type === "TSModuleDeclaration"
    )
      return true;
    ancestor = ancestor.parent;
  }
  return false;
};

const isErasedBinding = (symbol: SymbolDescriptor): boolean => {
  if (symbol.kind === "ts-interface" || symbol.kind === "ts-type-alias") return true;
  const imported = getImportDeclarationForSymbol(symbol);
  if (
    imported?.importKind === "type" ||
    (isNodeOfType(symbol.declarationNode, "ImportSpecifier") &&
      symbol.declarationNode.importKind === "type")
  )
    return true;
  let declaration: EsTreeNode | null | undefined = symbol.declarationNode;
  while (declaration) {
    if ("declare" in declaration && declaration.declare === true) return true;
    declaration = declaration.parent;
  }
  return false;
};

const getSymbolReferenceIndex = (
  program: EsTreeNode,
  scopes: ScopeAnalysis,
): SymbolReferenceIndex => {
  let indexesByProgram = indexesByScopes.get(scopes);
  if (!indexesByProgram) {
    indexesByProgram = new WeakMap();
    indexesByScopes.set(scopes, indexesByProgram);
  }
  const cached = indexesByProgram.get(program);
  if (cached) return cached;
  const index: SymbolReferenceIndex = {
    resolvedNodes: new Map(),
    ambiguousNodes: new Map(),
    completeness: new Map(),
  };
  const erasedBindings = new Map<SymbolDescriptor, boolean>();
  walkAst(program, (node) => {
    if (isKeyedDraftTypeReference(node)) return false;
    if (
      (!isNodeOfType(node, "Identifier") && !isNodeOfType(node, "JSXIdentifier")) ||
      isNonReferenceName(node)
    )
      return;
    const resolved = scopes.symbolFor(node);
    let isErased = resolved ? erasedBindings.get(resolved) : undefined;
    if (resolved && isErased === undefined) {
      isErased = isErasedBinding(resolved);
      erasedBindings.set(resolved, isErased);
    }
    if (resolved && !isErased) {
      const nodes = index.resolvedNodes.get(resolved) ?? [];
      nodes.push(node);
      index.resolvedNodes.set(resolved, nodes);
      return;
    }
    const nodes = index.ambiguousNodes.get(node.name) ?? [];
    nodes.push(node);
    index.ambiguousNodes.set(node.name, nodes);
  });
  indexesByProgram.set(program, index);
  return index;
};

export const hasCompleteSymbolReferences = (
  symbol: SymbolDescriptor,
  program: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const index = getSymbolReferenceIndex(program, scopes);
  const cached = index.completeness.get(symbol);
  if (cached !== undefined) return cached;
  const references = new Set(symbol.references);
  const isComplete = [
    index.resolvedNodes.get(symbol) ?? [],
    index.ambiguousNodes.get(symbol.name) ?? [],
  ].every((nodes) =>
    nodes.every((node) => {
      if (node === symbol.bindingIdentifier || node.name !== symbol.name) return true;
      const reference = scopes.referenceFor(node);
      return Boolean(
        !hasRuntimeTypeScriptAncestor(node) &&
        reference &&
        scopes.symbolFor(node) === symbol &&
        reference.resolvedSymbol === symbol &&
        references.has(reference),
      );
    }),
  );
  index.completeness.set(symbol, isComplete);
  return isComplete;
};
