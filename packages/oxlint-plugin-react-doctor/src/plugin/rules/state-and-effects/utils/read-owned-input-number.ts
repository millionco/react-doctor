import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { findProgramRoot } from "../../../utils/find-program-root.js";
import { getDirectUnreassignedInitializer } from "../../../utils/get-direct-unreassigned-initializer.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { hasSymbolBindingWrites } from "../../../utils/has-symbol-binding-writes.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";

export const readOwnedInputNumber = (
  expression: EsTreeNode,
  context: RuleContext,
  seen = new Set<number>(),
): number | null => {
  const value = stripParenExpression(expression);
  if (isNodeOfType(value, "Literal")) {
    return typeof value.value === "number" && Number.isFinite(value.value) ? value.value : null;
  }
  if (
    isNodeOfType(value, "UnaryExpression") &&
    (value.operator === "-" || value.operator === "+") &&
    isNodeOfType(value.argument, "Literal") &&
    typeof value.argument.value === "number" &&
    Number.isFinite(value.argument.value)
  ) {
    return value.operator === "-" ? -value.argument.value : value.argument.value;
  }
  const symbol = isNodeOfType(value, "Identifier") ? context.scopes.symbolFor(value) : null;
  const program = symbol && findProgramRoot(symbol.bindingIdentifier);
  if (
    !symbol ||
    symbol.kind !== "const" ||
    seen.has(symbol.id) ||
    !program ||
    hasSymbolBindingWrites(symbol) ||
    !hasCompleteSymbolReferences(symbol, program, context.scopes)
  ) {
    return null;
  }
  const initial = getDirectUnreassignedInitializer(symbol);
  if (!initial) return null;
  return readOwnedInputNumber(initial, context, new Set(seen).add(symbol.id));
};
