import type { EsTreeNode } from "./es-tree-node.js";
import { getImportedName as getImportSpecifierName } from "./get-imported-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { walkAst } from "./walk-ast.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";

const NESTED_RENDER_EVIDENCE_BOUNDARY_TYPES: ReadonlySet<string> = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "ClassDeclaration",
  "ClassExpression",
]);

const isReactImport = (symbol: SymbolDescriptor): boolean => {
  let importDeclaration: EsTreeNode | null | undefined = symbol.declarationNode?.parent;
  while (importDeclaration && !isNodeOfType(importDeclaration, "ImportDeclaration")) {
    importDeclaration = importDeclaration.parent ?? null;
  }
  if (!importDeclaration || !isNodeOfType(importDeclaration, "ImportDeclaration")) return false;
  return importDeclaration.source.value === "react";
};

const getImportedName = (symbol: SymbolDescriptor): string | null => {
  if (symbol.kind !== "import") return null;
  if (!isReactImport(symbol)) return null;
  return getImportSpecifierName(symbol.declarationNode) ?? null;
};

const isReactNamespaceImport = (symbol: SymbolDescriptor): boolean => {
  if (symbol.kind !== "import") return false;
  if (!isReactImport(symbol)) return false;
  return (
    isNodeOfType(symbol.declarationNode, "ImportDefaultSpecifier") ||
    isNodeOfType(symbol.declarationNode, "ImportNamespaceSpecifier")
  );
};

const isReactCreateElementIdentifierCall = (callee: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (!isNodeOfType(callee, "Identifier")) return false;
  const symbol = scopes.symbolFor(callee);
  return Boolean(symbol && getImportedName(symbol) === "createElement");
};

const isReactCreateElementMemberCall = (callee: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  if (callee.computed) return false;
  if (!isNodeOfType(callee.object, "Identifier")) return false;
  if (!isNodeOfType(callee.property, "Identifier")) return false;
  if (callee.property.name !== "createElement") return false;
  const symbol = scopes.symbolFor(callee.object);
  return Boolean(symbol && isReactNamespaceImport(symbol));
};

const isReactCreateElementCall = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  return (
    isReactCreateElementIdentifierCall(node.callee, scopes) ||
    isReactCreateElementMemberCall(node.callee, scopes)
  );
};

export const functionContainsReactRenderOutput = (
  functionNode: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  let didFindReactRenderOutput = false;

  walkAst(functionNode, (child) => {
    if (didFindReactRenderOutput) return false;
    if (child !== functionNode && NESTED_RENDER_EVIDENCE_BOUNDARY_TYPES.has(child.type)) {
      return false;
    }
    if (child.type === "JSXElement" || child.type === "JSXFragment") {
      didFindReactRenderOutput = true;
      return false;
    }
    if (isReactCreateElementCall(child, scopes)) {
      didFindReactRenderOutput = true;
      return false;
    }
    return undefined;
  });

  return didFindReactRenderOutput;
};
