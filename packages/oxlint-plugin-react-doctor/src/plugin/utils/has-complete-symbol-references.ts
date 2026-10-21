import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getImportDeclarationForSymbol } from "./get-import-declaration-for-symbol.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isTypeScriptTypePosition } from "./is-typescript-type-position.js";
import { walkAst } from "./walk-ast.js";

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

export const hasCompleteSymbolReferences = (
  symbol: SymbolDescriptor,
  program: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  let isComplete = true;
  walkAst(program, (node) => {
    if (!isComplete) return false;
    const runtimeTypeScript = hasRuntimeTypeScriptAncestor(node);
    if (!runtimeTypeScript && isTypeScriptTypePosition(node)) return false;
    if (
      (!isNodeOfType(node, "Identifier") && !isNodeOfType(node, "JSXIdentifier")) ||
      node.name !== symbol.name ||
      node === symbol.bindingIdentifier ||
      isNonReferenceName(node)
    )
      return;
    const resolved = scopes.symbolFor(node);
    if (resolved && resolved !== symbol && !isErasedBinding(resolved)) return;
    const reference = scopes.referenceFor(node);
    if (
      runtimeTypeScript ||
      !reference ||
      resolved !== symbol ||
      reference.resolvedSymbol !== symbol ||
      !symbol.references.includes(reference)
    ) {
      isComplete = false;
      return false;
    }
  });
  return isComplete;
};
