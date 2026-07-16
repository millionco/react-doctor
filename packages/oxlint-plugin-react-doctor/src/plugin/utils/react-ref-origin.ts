import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isReactApiCall } from "./is-react-api-call.js";
import { resolveConstIdentifierAlias } from "./resolve-const-identifier-alias.js";
import { stripParenExpression } from "./strip-paren-expression.js";

interface ResolveReactRefSymbolOptions {
  includeCreateRef?: boolean;
  allowUnboundBareCalls?: boolean;
  resolveNamedAliases?: boolean;
}

const REACT_REF_API_NAMES: ReadonlySet<string> = new Set(["createRef", "useRef"]);

export const resolveReactRefSymbol = (
  memberExpression: EsTreeNode,
  scopes: ScopeAnalysis,
  options: ResolveReactRefSymbolOptions = {},
): SymbolDescriptor | null => {
  const receiver = isNodeOfType(memberExpression, "MemberExpression")
    ? stripParenExpression(memberExpression.object)
    : null;
  if (
    !isNodeOfType(memberExpression, "MemberExpression") ||
    getStaticPropertyName(memberExpression) !== "current" ||
    !isNodeOfType(receiver, "Identifier")
  ) {
    return null;
  }
  const symbol = resolveConstIdentifierAlias(receiver, scopes);
  if (!symbol?.initializer) return null;
  const initializer = stripParenExpression(symbol.initializer);
  if (!isNodeOfType(initializer, "CallExpression")) return null;
  return isReactApiCall(
    initializer,
    options.includeCreateRef ? REACT_REF_API_NAMES : "useRef",
    scopes,
    {
      allowGlobalReactNamespace: true,
      allowUnboundBareCalls: options.allowUnboundBareCalls,
      resolveNamedAliases: options.resolveNamedAliases,
    },
  )
    ? symbol
    : null;
};

export const hasReactRefCurrentOrigin = (
  node: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number> = new Set(),
): boolean => {
  const expression = stripParenExpression(node);
  if (resolveReactRefSymbol(expression, scopes)) return true;
  if (!isNodeOfType(expression, "Identifier")) return false;
  const symbol = resolveConstIdentifierAlias(expression, scopes);
  if (!symbol?.initializer || visitedSymbolIds.has(symbol.id)) return false;
  visitedSymbolIds.add(symbol.id);
  return hasReactRefCurrentOrigin(symbol.initializer, scopes, visitedSymbolIds);
};
