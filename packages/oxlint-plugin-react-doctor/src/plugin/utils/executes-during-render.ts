import type { EsTreeNode } from "./es-tree-node.js";
import { isHookCall } from "./is-hook-call.js";
import { isNodeOfType } from "./is-node-of-type.js";

// Array iteration methods that invoke their callback synchronously — the
// callback runs wherever the method call itself executes, so it inherits
// the render-phase status of its call site.
const SYNCHRONOUS_ITERATION_METHOD_NAMES = new Set([
  "map",
  "filter",
  "forEach",
  "flatMap",
  "reduce",
  "reduceRight",
  "some",
  "every",
  "find",
  "findIndex",
  "findLast",
  "findLastIndex",
  "sort",
  "toSorted",
]);

// A nested function usually runs on a user event, not during the render
// pass — but three shapes DO execute while rendering: an immediately
// invoked function (`{(() => new Date().toLocaleString())()}`), a
// useMemo factory (`{useMemo(() => Date.now(), [])}`), and a synchronous
// iteration callback (`{rows.map((row) => …)}`).
export const executesDuringRender = (functionNode: EsTreeNode): boolean => {
  const parent = functionNode.parent;
  if (!isNodeOfType(parent, "CallExpression")) return false;
  if (parent.callee === functionNode) return true;
  if (isHookCall(parent, "useMemo") && parent.arguments?.[0] === functionNode) return true;
  if (isHookCall(parent, "useState") && parent.arguments?.[0] === functionNode) return true;
  return (
    isNodeOfType(parent.callee, "MemberExpression") &&
    !parent.callee.computed &&
    isNodeOfType(parent.callee.property, "Identifier") &&
    SYNCHRONOUS_ITERATION_METHOD_NAMES.has(parent.callee.property.name) &&
    parent.arguments?.[0] === functionNode
  );
};
