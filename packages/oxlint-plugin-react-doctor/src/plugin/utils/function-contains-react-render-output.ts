import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isReactApiCall, type ReactApiCallOptions } from "./is-react-api-call.js";
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

const containsRenderOutput = (rootNode: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  let hasRenderOutput = false;
  walkAst(rootNode, (node: EsTreeNode): boolean | void => {
    if (hasRenderOutput) return false;
    if (node !== rootNode && isNestedRenderEvidenceBoundary(node)) return false;
    if (
      node.type === "JSXElement" ||
      node.type === "JSXFragment" ||
      isReactApiCall(node, "createElement", scopes, REACT_CREATE_ELEMENT_OPTIONS)
    ) {
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
  const hasRenderOutput = containsRenderOutput(functionNode, scopes);
  renderOutputCache.set(functionNode, { scopes, hasRenderOutput });
  return hasRenderOutput;
};
