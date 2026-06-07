import type { Reference } from "eslint-scope";
import type { EsTreeNode } from "../../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../../utils/es-tree-node-of-type.js";
import { isAstNode } from "../../../../utils/is-ast-node.js";
import { isFunctionLike } from "../../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../../utils/is-node-of-type.js";
import { getScopeForNode, type ProgramAnalysis } from "./get-program-analysis.js";
import { VISITOR_KEYS } from "./constants.js";

// 1:1 port of upstream `src/util/ast.js` from
// `eslint-plugin-react-you-might-not-need-an-effect`. Upstream uses
// `context.sourceCode.getScope(node)` and `context.sourceCode.visitorKeys`.
// We thread the cached `ProgramAnalysis` (eslint-scope ScopeManager)
// through every helper and use `eslint-visitor-keys.KEYS` as the
// static visitorKeys table.

const getChildKeys = (node: EsTreeNode): ReadonlyArray<string> =>
  VISITOR_KEYS[node.type] ?? Object.keys(node).filter((key) => key !== "parent");

const ascend = (
  analysis: ProgramAnalysis,
  ref: Reference,
  visit: (ref: Reference) => boolean | undefined | void,
  visited: Set<Reference> = new Set(),
): void => {
  if (visited.has(ref)) return;
  const result = visit(ref);
  visited.add(ref);
  if (result === false) return;

  const defs = ref.resolved?.defs ?? [];
  for (const def of defs) {
    // Skip imports — terminate at the previous reference (actually
    // using the imported thing).
    if (def.type === "ImportBinding") continue;
    // Skip parameters — their definition node is the function, so
    // downstream would include the whole function body.
    if (def.type === "Parameter") continue;
    const defNode = def.node as unknown as Record<string, unknown>;
    const next = (defNode.init ?? defNode.body) as EsTreeNode | undefined;
    if (!next) continue;
    for (const innerRef of getDownstreamRefs(analysis, next)) {
      ascend(analysis, innerRef, visit, visited);
    }
  }
};

const descend = (
  node: EsTreeNode,
  visit: (node: EsTreeNode) => void,
  visited: Set<EsTreeNode> = new Set(),
): void => {
  if (visited.has(node)) return;
  visit(node);
  visited.add(node);

  const keys = getChildKeys(node);
  const record = node as unknown as Record<string, unknown>;
  for (const key of keys) {
    const child = record[key];
    if (!child) continue;
    if (Array.isArray(child)) {
      for (const item of child) {
        if (item && isAstNode(item)) descend(item as EsTreeNode, visit, visited);
      }
    } else if (isAstNode(child)) {
      descend(child as EsTreeNode, visit, visited);
    }
  }
};

export const getUpstreamRefs = (analysis: ProgramAnalysis, ref: Reference): Reference[] => {
  const refs: Reference[] = [];
  ascend(analysis, ref, (upRef) => {
    refs.push(upRef);
  });
  return refs;
};

export const findDownstreamNodes = (topNode: EsTreeNode, type: string): EsTreeNode[] => {
  const nodes: EsTreeNode[] = [];
  descend(topNode, (node) => {
    if (node.type === type) nodes.push(node);
  });
  return nodes;
};

export const getRef = (analysis: ProgramAnalysis, identifier: EsTreeNode): Reference | null => {
  const scope = getScopeForNode(identifier, analysis.scopeManager);
  if (!scope) return null;
  for (const reference of scope.references) {
    if (reference.identifier === identifier) return reference;
  }
  return null;
};

// Memoize per (analysis, node). `analysis` is the per-Program singleton
// (get-program-analysis.ts), so this WeakMap is stable for the file and
// self-cleaning (GC'd with the Program). Without it, ascend() re-descends
// the same large definition subtrees on every recursion step -> superlinear.
const downstreamRefsCache = new WeakMap<ProgramAnalysis, WeakMap<EsTreeNode, Reference[]>>();

export const getDownstreamRefs = (analysis: ProgramAnalysis, node: EsTreeNode): Reference[] => {
  let perNode = downstreamRefsCache.get(analysis);
  if (!perNode) {
    perNode = new WeakMap();
    downstreamRefsCache.set(analysis, perNode);
  }
  const cached = perNode.get(node);
  if (cached) return cached;
  const refs: Reference[] = [];
  for (const identifier of findDownstreamNodes(node, "Identifier")) {
    const ref = getRef(analysis, identifier);
    if (ref) refs.push(ref);
  }
  perNode.set(node, refs);
  return refs;
};

// Mirrors upstream's `getCallExpr(ref, current = ref.identifier.parent)`.
// Walks up MemberExpression chains so that for `obj.method()` the
// reference to `obj` resolves to the CallExpression. Returns null
// (instead of undefined) for symmetry with the rest of our helpers.
export const getCallExpr = (
  ref: Reference,
  current: EsTreeNode | null | undefined = (
    ref.identifier as unknown as { parent?: EsTreeNode | null }
  ).parent,
): EsTreeNode | null => {
  if (!current) return null;
  if (isNodeOfType(current, "CallExpression")) {
    let node: EsTreeNode = ref.identifier as unknown as EsTreeNode;
    let parent: EsTreeNode | null | undefined = (node as unknown as { parent?: EsTreeNode | null })
      .parent;
    while (parent && isNodeOfType(parent, "MemberExpression")) {
      node = parent;
      parent = (node as unknown as { parent?: EsTreeNode | null }).parent;
    }
    if (current.callee === (node as unknown as typeof current.callee)) {
      return current;
    }
  }
  if (isNodeOfType(current, "MemberExpression")) {
    return getCallExpr(ref, current.parent as EsTreeNode | undefined);
  }
  return null;
};

export const getArgsUpstreamRefs = (analysis: ProgramAnalysis, ref: Reference): Reference[] => {
  const result: Reference[] = [];
  for (const upRef of getUpstreamRefs(analysis, ref)) {
    const callExpr = getCallExpr(upRef);
    if (!callExpr || !isNodeOfType(callExpr, "CallExpression")) continue;
    for (const argument of callExpr.arguments ?? []) {
      for (const argRef of getDownstreamRefs(analysis, argument as EsTreeNode)) {
        for (const innerRef of getUpstreamRefs(analysis, argRef)) {
          result.push(innerRef);
        }
      }
    }
  }
  return result;
};

// Mirrors upstream `isSynchronous`. Uses live AST parent pointers
// (which oxlint provides intact during visitor callbacks).
export const isSynchronous = (node: EsTreeNode | null | undefined, within: EsTreeNode): boolean => {
  if (!node) return false;
  if (node === within) return true;
  const record = node as unknown as Record<string, unknown>;
  if (record.async === true) return false;
  if (
    isNodeOfType(node, "AwaitExpression") ||
    (isNodeOfType(node, "UnaryExpression") && node.operator === "void") ||
    isNodeOfType(node, "FunctionDeclaration") ||
    isNodeOfType(node, "FunctionExpression") ||
    isNodeOfType(node, "ArrowFunctionExpression")
  ) {
    return false;
  }
  return isSynchronous(node.parent, within);
};

// Resolves a reference to the function-like node its first definition
// denotes, unwrapping a `const fn = () => {}` declarator. Returns null
// when the reference doesn't resolve to a function. Shared by
// `getEffectFn`, `isCleanupReturnArgument`, and `resolvesToAsyncFunction`.
export const resolveToFunction = (
  ref: Reference,
):
  | EsTreeNodeOfType<"ArrowFunctionExpression">
  | EsTreeNodeOfType<"FunctionExpression">
  | EsTreeNodeOfType<"FunctionDeclaration">
  | null => {
  const definitionNode = ref.resolved?.defs[0]?.node as unknown as EsTreeNode | undefined;
  if (!definitionNode) return null;
  if (isFunctionLike(definitionNode)) return definitionNode;
  if (isNodeOfType(definitionNode, "VariableDeclarator") && isFunctionLike(definitionNode.init)) {
    return definitionNode.init;
  }
  return null;
};

// Coarse by design: any `async` intermediate function suppresses the
// indirect-setter diagnostic, even for a setter that runs synchronously
// before the first await. RDE parity showed this trade-off is safe in
// practice; tightening it would require await-position analysis.
export const resolvesToAsyncFunction = (ref: Reference): boolean =>
  Boolean(resolveToFunction(ref)?.async);

export const isEventualCallTo = (
  analysis: ProgramAnalysis,
  ref: Reference,
  predicate: (ref: Reference) => boolean,
): boolean => {
  const callExprRefs: Reference[] = [];
  ascend(analysis, ref, (upRef) => {
    const callExpr = getCallExpr(upRef);
    if (callExpr) {
      callExprRefs.push(upRef);
    } else {
      return false;
    }
  });
  return callExprRefs.some(predicate);
};
