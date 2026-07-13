import type { EsTreeNode } from "./es-tree-node.js";
import { functionReturnsMatchingExpression } from "./function-returns-matching-expression.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { hasStableCallTarget } from "./has-stable-call-target.js";
import { hasStaticPropertyWriteBefore } from "./has-static-property-write-before.js";
import { hasSymbolWriteBefore } from "./has-symbol-write-before.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isReactApiCall, type ReactApiCallOptions } from "./is-react-api-call.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";

const NESTED_RENDER_EVIDENCE_BOUNDARY_TYPES: ReadonlySet<string> = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "ClassDeclaration",
  "ClassExpression",
]);

const REACT_CREATE_ELEMENT_OPTIONS: ReactApiCallOptions = {
  allowGlobalReactNamespace: false,
  allowUnboundBareCalls: false,
};

const isArrayTypeAnnotation = (node: EsTreeNode): boolean => {
  if (isNodeOfType(node, "TSArrayType") || isNodeOfType(node, "TSTupleType")) return true;
  if (!isNodeOfType(node, "TSTypeReference")) return false;
  return (
    isNodeOfType(node.typeName, "Identifier") &&
    (node.typeName.name === "Array" || node.typeName.name === "ReadonlyArray")
  );
};

const hasArrayTypeAnnotation = (identifier: EsTreeNode): boolean => {
  if (!isNodeOfType(identifier, "Identifier")) return false;
  const typeAnnotation = identifier.typeAnnotation;
  return Boolean(
    typeAnnotation &&
    isNodeOfType(typeAnnotation, "TSTypeAnnotation") &&
    isArrayTypeAnnotation(typeAnnotation.typeAnnotation),
  );
};

const isProvenArrayExpression = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  referenceNode: EsTreeNode,
  visitedSymbolIds = new Set<number>(),
): boolean => {
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "ArrayExpression")) return true;
  if (!isNodeOfType(candidate, "Identifier")) return false;
  const symbol = scopes.symbolFor(candidate);
  if (!symbol || visitedSymbolIds.has(symbol.id) || hasSymbolWriteBefore(symbol, referenceNode)) {
    return false;
  }
  if (hasArrayTypeAnnotation(symbol.bindingIdentifier)) return true;
  if (!symbol.initializer) return false;
  visitedSymbolIds.add(symbol.id);
  return isProvenArrayExpression(symbol.initializer, scopes, referenceNode, visitedSymbolIds);
};

const isProvenArrayMapCall = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  const callee = stripParenExpression(node.callee);
  if (!isNodeOfType(callee, "MemberExpression") || getStaticPropertyName(callee) !== "map") {
    return false;
  }
  const receiver = stripParenExpression(callee.object);
  if (!isProvenArrayExpression(receiver, scopes, node)) return false;
  return !(
    isNodeOfType(receiver, "Identifier") &&
    hasStaticPropertyWriteBefore(receiver, "map", node, scopes)
  );
};

const isRenderPreservingCallArgumentFunction = (
  node: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (node.type !== "ArrowFunctionExpression" && node.type !== "FunctionExpression") {
    return false;
  }
  const parent = node.parent;
  if (!isNodeOfType(parent, "CallExpression")) return false;
  if (
    isReactApiCall(parent, "useMemo", scopes, { resolveNamedAliases: true }) &&
    hasStableCallTarget(parent, scopes)
  ) {
    return parent.arguments[0] === node;
  }
  return (
    parent.arguments.some((argumentNode) => argumentNode === node) &&
    isProvenArrayMapCall(parent, scopes)
  );
};

const isNestedRenderEvidenceBoundary = (node: EsTreeNode, scopes: ScopeAnalysis): boolean =>
  NESTED_RENDER_EVIDENCE_BOUNDARY_TYPES.has(node.type) &&
  !isRenderPreservingCallArgumentFunction(node, scopes);

const isRenderOutputExpression = (node: EsTreeNode, scopes: ScopeAnalysis): boolean =>
  node.type === "JSXElement" ||
  node.type === "JSXFragment" ||
  isReactApiCall(node, "createElement", scopes, REACT_CREATE_ELEMENT_OPTIONS);

const containsRenderOutput = (rootNode: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  let hasRenderOutput = false;
  walkAst(rootNode, (node: EsTreeNode): boolean | void => {
    if (hasRenderOutput) return false;
    if (node !== rootNode && isNestedRenderEvidenceBoundary(node, scopes)) return false;
    if (isRenderOutputExpression(node, scopes)) {
      hasRenderOutput = true;
      return false;
    }
  });
  return hasRenderOutput;
};

interface RenderOutputCacheEntry {
  scopes: ScopeAnalysis;
  hasRenderOutput: boolean;
}

// The walk result is a pure function of (functionNode, scopes), and the host
// shares one ScopeAnalysis per Program across every rule (see
// wrap-with-semantic-context.ts), so the ~5 rules re-querying the same
// function node collapse to one subtree walk per file. The scopes-identity
// guard recomputes if a different analysis ever shows up for the same node
// (the pre-capture fallback scopes, or tests building their own analysis).
// Entries die with the AST via the WeakMap.
const renderOutputCache = new WeakMap<EsTreeNode, RenderOutputCacheEntry>();

export const functionContainsReactRenderOutput = (
  functionNode: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const cachedEntry = renderOutputCache.get(functionNode);
  if (cachedEntry && cachedEntry.scopes === scopes) return cachedEntry.hasRenderOutput;
  const hasRenderOutput = functionReturnsMatchingExpression(functionNode, scopes, (expression) =>
    containsRenderOutput(expression, scopes),
  );
  renderOutputCache.set(functionNode, { scopes, hasRenderOutput });
  return hasRenderOutput;
};
