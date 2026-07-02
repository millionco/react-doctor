import { FETCH_CALLEE_NAMES, FETCH_MEMBER_OBJECTS } from "../constants/library.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { walkAst } from "./walk-ast.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

interface ContainsFetchCallOptions {
  // Prune the walk at nested function boundaries so only fetches that run
  // synchronously in `node`'s own body match — skipping event handlers and
  // escaping callbacks declared inside it (which run on a later user
  // interaction), while still descending into nested functions the body
  // itself invokes (async IIFEs, `async function loadData(){...} loadData()`,
  // `const loadData = async () => {...}; void loadData()`).
  stopAtFunctionBoundary?: boolean;
}

const isFetchCall = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  if (isNodeOfType(node.callee, "Identifier") && FETCH_CALLEE_NAMES.has(node.callee.name)) {
    return true;
  }
  return (
    isNodeOfType(node.callee, "MemberExpression") &&
    isNodeOfType(node.callee.object, "Identifier") &&
    FETCH_MEMBER_OBJECTS.has(node.callee.object.name)
  );
};

const containsSynchronouslyInvokedFetchCall = (rootNode: EsTreeNode): boolean => {
  const invokedFunctionNodes = new Set<EsTreeNode>();
  let didInvokedSetGrow = true;
  while (didInvokedSetGrow) {
    let didFindFetchCall = false;
    const namedFunctionNodes = new Map<string, EsTreeNode>();
    const invokedCalleeNames = new Set<string>();
    const directCalleeFunctionNodes = new Set<EsTreeNode>();
    walkAst(rootNode, (child) => {
      if (child !== rootNode && isFunctionLike(child)) {
        if (isNodeOfType(child, "FunctionDeclaration") && child.id) {
          namedFunctionNodes.set(child.id.name, child);
        }
        if (!invokedFunctionNodes.has(child)) return false;
      }
      if (isNodeOfType(child, "VariableDeclarator") && isNodeOfType(child.id, "Identifier")) {
        const declaratorInitializer = child.init ? stripParenExpression(child.init) : null;
        if (isFunctionLike(declaratorInitializer)) {
          namedFunctionNodes.set(child.id.name, declaratorInitializer);
        }
      }
      if (!isNodeOfType(child, "CallExpression")) return;
      if (isFetchCall(child)) didFindFetchCall = true;
      const unwrappedCallee = stripParenExpression(child.callee);
      if (isFunctionLike(unwrappedCallee)) directCalleeFunctionNodes.add(unwrappedCallee);
      if (isNodeOfType(unwrappedCallee, "Identifier")) {
        invokedCalleeNames.add(unwrappedCallee.name);
      }
    });
    if (didFindFetchCall) return true;
    const previousInvokedCount = invokedFunctionNodes.size;
    for (const directCalleeFunctionNode of directCalleeFunctionNodes) {
      invokedFunctionNodes.add(directCalleeFunctionNode);
    }
    for (const invokedCalleeName of invokedCalleeNames) {
      const namedFunctionNode = namedFunctionNodes.get(invokedCalleeName);
      if (namedFunctionNode) invokedFunctionNodes.add(namedFunctionNode);
    }
    didInvokedSetGrow = invokedFunctionNodes.size > previousInvokedCount;
  }
  return false;
};

export const containsFetchCall = (
  node: EsTreeNode,
  options?: ContainsFetchCallOptions,
): boolean => {
  if (options?.stopAtFunctionBoundary) return containsSynchronouslyInvokedFetchCall(node);
  let didFindFetchCall = false;
  walkAst(node, (child) => {
    if (isFetchCall(child)) didFindFetchCall = true;
  });
  return didFindFetchCall;
};
