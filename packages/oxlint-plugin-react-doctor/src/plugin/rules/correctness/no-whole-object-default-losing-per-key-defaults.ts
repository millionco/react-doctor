import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { RuleVisitors } from "../../utils/rule-visitors.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";

// A whole-object parameter default (`({ a, b } = { a: 1, b: 'x' })`)
// only applies when the argument is omitted ENTIRELY. The instant a
// caller passes any object, the default object is discarded wholesale
// and every key the caller left out becomes `undefined` — silently
// bypassing the intended fallback. The correct form applies each
// default independently: `({ a = 1, b = 'x' } = {})`.
//
// Scope-fix (fires only when a per-key default is actually reachable to
// lose, and losing it changes behavior):
//   1. the parameter is `ObjectPattern = ObjectExpression` (TS wrappers
//      like `as` / `satisfies` around the object are peeled first),
//   2. at least one destructured binding lacks its OWN default AND has a
//      matching `key: value` property in the default object — that value
//      is the fallback a partial call silently drops,
//   3. at least one such dropped fallback is something other than the
//      literal `false` — boolean-flag bags defaulting everything to
//      `false` are consumed in truthiness checks where `undefined`
//      behaves identically, so nothing observable is lost.
// `= {}` (the recommended idiom), patterns where every binding is
// already defaulted, and all-`false` flag bags stay quiet.

const getStaticPropertyKey = (property: EsTreeNodeOfType<"Property">): string | null => {
  if (property.computed) return null;
  const key = property.key as EsTreeNode;
  if (isNodeOfType(key, "Identifier")) return key.name;
  if (isNodeOfType(key, "Literal")) return String(key.value);
  return null;
};

// Keys of bindings that carry no `= default` of their own — the bindings
// whose fallback the whole-object default silently drops on a
// partial-argument call.
const collectUndefaultedBindingKeys = (
  objectPattern: EsTreeNodeOfType<"ObjectPattern">,
): Set<string> => {
  const undefaultedBindingKeys = new Set<string>();
  for (const property of objectPattern.properties ?? []) {
    if (!isNodeOfType(property, "Property")) continue;
    if (isNodeOfType(property.value as EsTreeNode, "AssignmentPattern")) continue;
    const bindingKey = getStaticPropertyKey(property);
    if (bindingKey !== null) undefaultedBindingKeys.add(bindingKey);
  }
  return undefaultedBindingKeys;
};

// The default-object values that a partial call actually drops: each
// `key: value` whose key matches an undefaulted binding.
const collectDroppedFallbackValues = (
  objectExpression: EsTreeNodeOfType<"ObjectExpression">,
  undefaultedBindingKeys: Set<string>,
): Array<EsTreeNode> => {
  const droppedFallbackValues: Array<EsTreeNode> = [];
  for (const property of objectExpression.properties ?? []) {
    if (!isNodeOfType(property, "Property")) continue;
    const propertyKey = getStaticPropertyKey(property);
    if (propertyKey === null || !undefaultedBindingKeys.has(propertyKey)) continue;
    droppedFallbackValues.push(property.value as EsTreeNode);
  }
  return droppedFallbackValues;
};

// `false` fallbacks feed truthiness checks where `undefined` behaves
// identically, so dropping them is a runtime no-op.
const isFalseLiteral = (value: EsTreeNode): boolean => {
  const innerValue = stripParenExpression(value);
  return isNodeOfType(innerValue, "Literal") && innerValue.value === false;
};

// True when the AssignmentPattern is a direct parameter of a function
// (not a nested destructuring default inside another pattern).
const isFunctionParameter = (assignmentPattern: EsTreeNode): boolean => {
  const parent = assignmentPattern.parent;
  return Boolean(
    parent &&
    isFunctionLike(parent) &&
    parent.params?.some((parameter) => parameter === assignmentPattern),
  );
};

export const noWholeObjectDefaultLosingPerKeyDefaults = defineRule({
  id: "no-whole-object-default-losing-per-key-defaults",
  title: "Whole-object param default loses per-key defaults",
  severity: "warn",
  category: "Correctness",
  tags: ["test-noise"],
  recommendation:
    "A whole-object parameter default applies only when the argument is omitted entirely, so a partial argument makes every omitted key undefined. Move each fallback onto its own binding instead: `({ a = 1, b = false } = {})`.",
  create: (context: RuleContext): RuleVisitors => ({
    AssignmentPattern(node: EsTreeNodeOfType<"AssignmentPattern">) {
      if (!isFunctionParameter(node)) return;
      const pattern = node.left as EsTreeNode;
      const defaultValue = stripParenExpression(node.right as EsTreeNode);
      if (!isNodeOfType(pattern, "ObjectPattern")) return;
      if (!isNodeOfType(defaultValue, "ObjectExpression")) return;
      const undefaultedBindingKeys = collectUndefaultedBindingKeys(pattern);
      if (undefaultedBindingKeys.size === 0) return;
      const droppedFallbackValues = collectDroppedFallbackValues(
        defaultValue,
        undefaultedBindingKeys,
      );
      if (droppedFallbackValues.length === 0) return;
      if (droppedFallbackValues.every(isFalseLiteral)) return;
      context.report({
        node,
        message:
          "This whole-object default is discarded the moment a caller passes any object, so every omitted key becomes undefined instead of falling back. Give each binding its own default instead: `({ a = 1, b = false } = {})`.",
      });
    },
  }),
});
