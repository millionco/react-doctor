import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../es-tree-node.js";
import { getImportDeclarationForSymbol } from "../get-import-declaration-for-symbol.js";
import { isFunctionLike } from "../is-function-like.js";
import { isNodeOfType } from "../is-node-of-type.js";
import { isTypeOnlyImport } from "../is-type-only-import.js";
import { NATIVE_DELAY_MAX_SCOPE_ANCESTRY_DEPTH } from "./native-signal-delay/constants.js";

const hasRuntimeDeclarationAncestry = (node: EsTreeNode, program: EsTreeNode): boolean => {
  let ancestor: EsTreeNode | null | undefined = node;
  for (let depth = 0; depth < NATIVE_DELAY_MAX_SCOPE_ANCESTRY_DEPTH; depth += 1) {
    if (!ancestor) return false;
    if (ancestor === program) return true;
    if (
      ("declare" in ancestor && ancestor.declare) ||
      isNodeOfType(ancestor, "TSDeclareFunction")
    ) {
      return false;
    }
    ancestor = ancestor.parent;
  }
  return false;
};

const isErasedReferencePosition = (node: EsTreeNode, program: EsTreeNode): boolean | null => {
  let ancestor: EsTreeNode | null | undefined = node;
  for (let depth = 0; depth < NATIVE_DELAY_MAX_SCOPE_ANCESTRY_DEPTH; depth += 1) {
    if (!ancestor) return null;
    if (ancestor === program) return false;
    if (
      isNodeOfType(ancestor, "TSInterfaceDeclaration") ||
      isNodeOfType(ancestor, "TSTypeAliasDeclaration") ||
      ("declare" in ancestor && ancestor.declare) ||
      (isNodeOfType(ancestor, "ExportSpecifier") && ancestor.exportKind === "type") ||
      (isNodeOfType(ancestor, "ExportNamedDeclaration") && ancestor.exportKind === "type")
    )
      return true;
    ancestor = ancestor.parent;
  }
  return null;
};

const hasSupportedVariableHoisting = (node: EsTreeNode, program: EsTreeNode): boolean => {
  let ancestor: EsTreeNode | null | undefined = node.parent;
  for (let depth = 0; depth < NATIVE_DELAY_MAX_SCOPE_ANCESTRY_DEPTH; depth += 1) {
    if (!ancestor) return false;
    if (ancestor === program || isFunctionLike(ancestor)) return true;
    if (isNodeOfType(ancestor, "TSModuleDeclaration") || isNodeOfType(ancestor, "StaticBlock"))
      return false;
    ancestor = ancestor.parent;
  }
  return false;
};

export const isSupportedRuntimeScopeNode = (
  node: EsTreeNode,
  scopes: ScopeAnalysis,
  certifiedErasedDefaultReferences?: ReadonlySet<EsTreeNode>,
): boolean => {
  if (!isNodeOfType(scopes.rootScope.node, "Program")) return false;
  if (
    isNodeOfType(node, "StaticBlock") ||
    (isNodeOfType(node, "VariableDeclaration") && node.kind === "var")
  ) {
    const erasedPosition = isErasedReferencePosition(node, scopes.rootScope.node);
    if (erasedPosition !== false) return erasedPosition === true;
    return (
      !isNodeOfType(node, "StaticBlock") &&
      hasSupportedVariableHoisting(node, scopes.rootScope.node)
    );
  }
  if (
    isNodeOfType(node, "FunctionDeclaration") ||
    isNodeOfType(node, "TSEnumDeclaration") ||
    isNodeOfType(node, "TSModuleDeclaration") ||
    isNodeOfType(node, "TSImportEqualsDeclaration")
  ) {
    const erasedPosition = isErasedReferencePosition(node, scopes.rootScope.node);
    if (erasedPosition !== false) return erasedPosition === true;
    const parent = node.parent;
    const isModuleDeclaration =
      parent === scopes.rootScope.node ||
      ((isNodeOfType(parent, "ExportNamedDeclaration") ||
        isNodeOfType(parent, "ExportDefaultDeclaration")) &&
        parent.declaration === node &&
        parent.parent === scopes.rootScope.node);
    const isFunctionBodyDeclaration =
      isNodeOfType(parent, "BlockStatement") &&
      isFunctionLike(parent.parent) &&
      parent.parent.body === parent;
    return (
      (isModuleDeclaration || isFunctionBodyDeclaration) &&
      hasRuntimeDeclarationAncestry(node, scopes.rootScope.node)
    );
  }
  if (!isNodeOfType(node, "Identifier") && !isNodeOfType(node, "JSXIdentifier")) return true;
  const reference = scopes.referenceFor(node);
  const symbol = reference?.resolvedSymbol;
  if (!symbol) return true;
  const erasedPosition = isErasedReferencePosition(node, scopes.rootScope.node);
  if (erasedPosition !== false) return erasedPosition === true;
  if (symbol.kind === "ts-interface" || symbol.kind === "ts-type-alias")
    return certifiedErasedDefaultReferences?.has(node) ?? false;
  if (
    symbol.kind === "ts-enum" &&
    isNodeOfType(symbol.declarationNode, "TSEnumDeclaration") &&
    symbol.declarationNode.const
  )
    return false;
  if (symbol.kind === "import") {
    const declaration = getImportDeclarationForSymbol(symbol);
    if (
      !declaration ||
      isTypeOnlyImport(declaration) ||
      (isNodeOfType(symbol.declarationNode, "ImportSpecifier") &&
        symbol.declarationNode.importKind === "type")
    )
      return false;
  }
  if (
    isNodeOfType(symbol.declarationNode, "TSImportEqualsDeclaration") &&
    symbol.declarationNode.importKind === "type"
  )
    return false;
  return hasRuntimeDeclarationAncestry(symbol.declarationNode, scopes.rootScope.node);
};
