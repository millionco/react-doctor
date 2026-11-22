import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getExecutableValueReferences } from "../../../utils/get-executable-value-references.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { someAst } from "../../../utils/some-ast.js";

export interface ClosedNativeEventConsumer {
  readonly callback: EsTreeNodeOfType<"ArrowFunctionExpression">;
  readonly eventField: string;
  readonly eventSymbol: SymbolDescriptor | null;
  readonly eventDiscarded: boolean;
  readonly stopPropagationCalls: ReadonlyArray<EsTreeNodeOfType<"CallExpression">>;
  // The caller must prove these payload fields are primitive data, not another
  // channel for the native event, a node or an object containing such a value.
  readonly otherFields: ReadonlyArray<{
    readonly field: string;
    readonly symbol: SymbolDescriptor;
  }>;
}
const staticKey = (node: EsTreeNode): string | null => {
  if (isNodeOfType(node, "Identifier")) return node.name;
  return isNodeOfType(node, "Literal") && typeof node.value === "string" ? node.value : null;
};

/** Closes one native-event payload field in one already-resolved callback.
 * Does not prove the caller/provider, callback identity, other payload fields,
 * stock Event.prototype, or the callback's unrelated behavior. */
export const readClosedNativeEventConsumer = (
  callback: EsTreeNode,
  scopes: ScopeAnalysis,
  eventField = "event",
): ClosedNativeEventConsumer | null => {
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    callback.async ||
    callback.params.length !== 1 ||
    !isNodeOfType(callback.params[0], "ObjectPattern") ||
    !eventField ||
    eventField === "__proto__" ||
    someAst(
      callback,
      (node) =>
        isNodeOfType(node, "WithStatement") ||
        (isNodeOfType(node, "Identifier") && (node.name === "eval" || node.name === "arguments")),
    )
  )
    return null;
  const keys = new Set<string>();
  const otherFields: Array<{ field: string; symbol: SymbolDescriptor }> = [];
  let eventSymbol: SymbolDescriptor | null = null;
  for (const property of callback.params[0].properties) {
    if (
      !isNodeOfType(property, "Property") ||
      property.computed ||
      property.method ||
      property.kind !== "init" ||
      !isNodeOfType(property.value, "Identifier")
    )
      return null;
    const key = staticKey(property.key);
    if (key === null || key === "__proto__" || keys.has(key)) return null;
    keys.add(key);
    const symbol = scopes.symbolFor(property.value);
    if (
      !symbol ||
      symbol.kind !== "parameter" ||
      symbol.bindingIdentifier !== property.value ||
      !hasCompleteSymbolReferences(symbol, scopes.rootScope.node, scopes) ||
      getExecutableValueReferences(symbol).some((reference) => reference.flag !== "read")
    )
      return null;
    if (key === eventField) eventSymbol = symbol;
    else otherFields.push({ field: key, symbol });
  }
  const calls: Array<EsTreeNodeOfType<"CallExpression">> = [];
  for (const reference of eventSymbol ? getExecutableValueReferences(eventSymbol) : []) {
    if (findEnclosingFunction(reference.identifier) !== callback) return null;
    const receiver = findTransparentExpressionRoot(reference.identifier);
    const member = receiver.parent;
    const method = member && findTransparentExpressionRoot(member);
    const call = method?.parent;
    if (
      !isNodeOfType(member, "MemberExpression") ||
      member.object !== receiver ||
      member.computed ||
      member.optional ||
      !isNodeOfType(member.property, "Identifier") ||
      member.property.name !== "stopPropagation" ||
      !isNodeOfType(call, "CallExpression") ||
      call.callee !== method ||
      call.optional ||
      call.arguments.length !== 0
    )
      return null;
    calls.push(call);
  }
  return {
    callback,
    eventField,
    eventSymbol,
    eventDiscarded: calls.length === 0,
    stopPropagationCalls: calls,
    otherFields,
  };
};
