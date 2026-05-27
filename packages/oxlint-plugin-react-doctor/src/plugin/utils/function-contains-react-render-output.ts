import type { EsTreeNode } from "./es-tree-node.js";
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
  const declarationNode = symbol.declarationNode;
  if (!isNodeOfType(declarationNode, "ImportSpecifier")) return null;
  const importedName = declarationNode.imported;
  if (isNodeOfType(importedName, "Identifier")) return importedName.name;
  if (isNodeOfType(importedName, "Literal") && typeof importedName.value === "string") {
    return importedName.value;
  }
  return null;
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
