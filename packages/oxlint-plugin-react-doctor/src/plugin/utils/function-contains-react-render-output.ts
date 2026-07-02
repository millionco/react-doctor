import type { EsTreeNode } from "./es-tree-node.js";
import { getImportedName as getImportSpecifierName } from "./get-imported-name.js";
import { isAstNode } from "./is-ast-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";

const NESTED_RENDER_EVIDENCE_BOUNDARY_TYPES: ReadonlySet<string> = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "ClassDeclaration",
  "ClassExpression",
]);

// A function expression passed directly as a call argument
// (`items.map(item => <li/>)`, `useMemo(() => <div/>, deps)`) feeds the
// enclosing component's render output, so JSX inside it still counts as
// render evidence. Function expressions in any other position (assigned
// handlers, JSX attribute values) and declarations/classes stay boundaries.
const isCallArgumentFunctionExpression = (node: EsTreeNode): boolean => {
  if (node.type !== "ArrowFunctionExpression" && node.type !== "FunctionExpression") {
    return false;
  }
  const parent = node.parent;
  if (!isNodeOfType(parent, "CallExpression")) return false;
  return parent.arguments.some((argumentNode) => argumentNode === node);
};

const isNestedRenderEvidenceBoundary = (node: EsTreeNode): boolean =>
  NESTED_RENDER_EVIDENCE_BOUNDARY_TYPES.has(node.type) && !isCallArgumentFunctionExpression(node);

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

const containsRenderOutput = (
  node: EsTreeNode,
  rootNode: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (node !== rootNode && isNestedRenderEvidenceBoundary(node)) {
    return false;
  }
  if (node.type === "JSXElement" || node.type === "JSXFragment") {
    return true;
  }
  if (isReactCreateElementCall(node, scopes)) {
    return true;
  }
  const nodeRecord = node as unknown as Record<string, unknown>;
  for (const key of Object.keys(nodeRecord)) {
    if (key === "parent") continue;
    const child = nodeRecord[key];
    if (Array.isArray(child)) {
      for (const innerChild of child) {
        if (isAstNode(innerChild) && containsRenderOutput(innerChild, rootNode, scopes)) {
          return true;
        }
      }
    } else if (isAstNode(child) && containsRenderOutput(child, rootNode, scopes)) {
      return true;
    }
  }
  return false;
};

export const functionContainsReactRenderOutput = (
  functionNode: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => containsRenderOutput(functionNode, functionNode, scopes);
