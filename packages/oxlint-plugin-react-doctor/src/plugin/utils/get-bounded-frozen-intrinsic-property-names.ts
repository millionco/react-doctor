import {
  FROZEN_COLLECTION_PROPERTY_KEY_MAX_EXPRESSIONS,
  FROZEN_COLLECTION_PROPERTY_KEY_MAX_CHARS,
  STATIC_STRING_VALUE_LIMIT,
} from "../constants/thresholds.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getDirectUnreassignedInitializer } from "./get-direct-unreassigned-initializer.js";
import { getFiniteStaticStringValues } from "./get-finite-static-string-values.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { getStaticStringExpression } from "./get-static-string-expression.js";
import { isNodeOfType } from "./is-node-of-type.js";
import type { RuleContext } from "./rule-context.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export interface FrozenIntrinsicPropertyNames {
  readonly names: ReadonlySet<string>;
  readonly didExceedBudget: boolean;
}

export const getBoundedFrozenIntrinsicPropertyNames = (
  node: EsTreeNode,
  context: RuleContext,
): FrozenIntrinsicPropertyNames => {
  if (!isNodeOfType(node, "MemberExpression") && !isNodeOfType(node, "Property"))
    return { names: new Set(), didExceedBudget: false };
  if (!node.computed) {
    const name = getStaticPropertyKeyName(node);
    return { names: new Set(name === null ? [] : [name]), didExceedBudget: false };
  }
  const expression = isNodeOfType(node, "MemberExpression") ? node.property : node.key;
  // HACK: Bound expanded alias work before calling the shared recursive evaluator.
  const pending: EsTreeNode[] = [expression];
  let expressionCount = 0;
  let characterCount = 0;
  while (pending.length > 0) {
    if (++expressionCount > FROZEN_COLLECTION_PROPERTY_KEY_MAX_EXPRESSIONS)
      return { names: new Set(), didExceedBudget: true };
    const candidate = pending.pop();
    if (!candidate) continue;
    const current = stripParenExpression(candidate);
    const literal = getStaticStringExpression(current);
    if (literal !== null) {
      characterCount += literal.length;
      if (characterCount > FROZEN_COLLECTION_PROPERTY_KEY_MAX_CHARS)
        return { names: new Set(), didExceedBudget: true };
      continue;
    }
    if (isNodeOfType(current, "Identifier")) {
      const symbol = context.scopes.symbolFor(current);
      const initializer = symbol && getDirectUnreassignedInitializer(symbol);
      if (initializer) pending.push(initializer);
      continue;
    }
    if (isNodeOfType(current, "ConditionalExpression")) {
      pending.push(current.alternate, current.consequent);
      continue;
    }
    if (isNodeOfType(current, "LogicalExpression")) {
      pending.push(current.right, current.left);
      continue;
    }
    if (isNodeOfType(current, "SequenceExpression")) {
      const finalExpression = current.expressions.at(-1);
      if (finalExpression) pending.push(finalExpression);
      continue;
    }
    if (isNodeOfType(current, "AssignmentExpression") && current.operator === "=") {
      pending.push(current.right);
      continue;
    }
    if (isNodeOfType(current, "BinaryExpression") && current.operator === "+") {
      pending.push(current.right, current.left);
      continue;
    }
  }
  const names = getFiniteStaticStringValues(expression, context);
  return { names, didExceedBudget: names.size >= STATIC_STRING_VALUE_LIMIT };
};
