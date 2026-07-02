import type { EsTreeNode } from "./es-tree-node.js";
import { getImportedName as getImportSpecifierName } from "./get-imported-name.js";
import { isAstNode } from "./is-ast-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";

const NESTED_RENDER_EVIDENCE_BOUNDARY_TYPES: ReadonlySet<string> = new Set([
  "FunctionDeclaration",
  "ClassDeclaration",
  "ClassExpression",
]);

const NESTED_FUNCTION_EXPRESSION_TYPES: ReadonlySet<string> = new Set([
  "FunctionExpression",
  "ArrowFunctionExpression",
]);

// A nested function expression bound to a name (a nested component /
// render-helper definition) is its own render unit, so its JSX is not
// evidence that the OUTER function renders. An unbound function
// expression — a callback argument (`rows.map(row => <tr/>)`,
// `useMemo(() => <div/>)`) or a returned closure — feeds its output
// into the outer function's render, so its JSX counts.
const NESTED_FUNCTION_EXPRESSION_BINDING_PARENT_TYPES: ReadonlySet<string> = new Set([
  "VariableDeclarator",
  "AssignmentExpression",
  "Property",
  "PropertyDefinition",
  "MethodDefinition",
]);

const isNestedRenderEvidenceBoundary = (node: EsTreeNode): boolean => {
  if (NESTED_RENDER_EVIDENCE_BOUNDARY_TYPES.has(node.type)) return true;
  if (!NESTED_FUNCTION_EXPRESSION_TYPES.has(node.type)) return false;
  const parentType = node.parent?.type;
  return (
    parentType !== undefined && NESTED_FUNCTION_EXPRESSION_BINDING_PARENT_TYPES.has(parentType)
  );
};

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
