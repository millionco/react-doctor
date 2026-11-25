import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { isNodeOfType } from "./is-node-of-type.js";

// Separately qualify the selected browser realm before trusting its timer.
export const isNativeTimeoutCallbackDispatcher = (
  fn: EsTreeNodeOfType<"ArrowFunctionExpression">,
  scopes: ScopeAnalysis,
): boolean => {
  const callback = fn.params[0];
  if (!isNodeOfType(callback, "Identifier") || fn.async) return false;
  const symbol = scopes.symbolFor(callback);
  if (!symbol || !hasCompleteSymbolReferences(symbol, fn, scopes) || !symbol.references.length)
    return false;
  return symbol.references.every(({ identifier, flag }) => {
    const invoke = identifier.parent;
    if (
      flag !== "read" ||
      !isNodeOfType(invoke, "CallExpression") ||
      invoke.optional ||
      invoke.callee !== identifier ||
      invoke.arguments.length !== 0
    )
      return false;
    const body = invoke.parent?.parent;
    const task = body?.parent;
    if (
      !isNodeOfType(invoke.parent, "ExpressionStatement") ||
      !isNodeOfType(body, "BlockStatement") ||
      !isNodeOfType(task, "ArrowFunctionExpression") ||
      task.async ||
      task.body !== body
    )
      return false;
    const scheduled = task.parent;
    if (
      !isNodeOfType(scheduled, "CallExpression") ||
      scheduled.optional ||
      scheduled.arguments[0] !== task ||
      !isNodeOfType(scheduled.callee, "MemberExpression")
    )
      return false;
    const { object, property, optional, computed } = scheduled.callee;
    return (
      !optional &&
      !computed &&
      isNodeOfType(property, "Identifier") &&
      property.name === "setTimeout" &&
      isNodeOfType(object, "Identifier") &&
      object.name === "window" &&
      scopes.isGlobalReference(object)
    );
  });
};
