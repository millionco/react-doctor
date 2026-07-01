import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { RuleVisitors } from "../../utils/rule-visitors.js";

// A whole-object parameter default (`({ a, b } = { a: 1, b: false })`)
// only applies when the argument is omitted ENTIRELY. The instant a
// caller passes any object, the default object is discarded wholesale
// and every key the caller left out becomes `undefined` — silently
// bypassing the intended fallback. The correct form applies each
// default independently: `({ a = 1, b = false } = {})`.
//
// Scope-fix (fires only when a per-key default is actually reachable to
// lose):
//   1. the parameter is `ObjectPattern = ObjectExpression`,
//   2. the default ObjectExpression carries >= 1 `key: value` property,
//   3. at least one destructured binding lacks its OWN default.
// `= {}` (the recommended idiom) and patterns where every binding is
// already defaulted stay quiet.

// True when the parameter's ObjectPattern has at least one binding that
// carries no `= default` of its own — the bindings whose fallback the
// whole-object default silently drops on a partial-argument call.
const hasBindingWithoutOwnDefault = (objectPattern: EsTreeNodeOfType<"ObjectPattern">): boolean => {
  for (const property of objectPattern.properties ?? []) {
    // A rest element (`{ ...rest }`) collects the remaining keys; it is
    // not a per-key default that can be lost, so it doesn't count.
    if (isNodeOfType(property, "RestElement")) continue;
    if (!isNodeOfType(property, "Property")) continue;
    // A binding carries its own default only when its value node is an
    // AssignmentPattern (`{ a = 1 }`). Anything else (a bare Identifier,
    // a nested pattern with no default) lacks one.
    if (!isNodeOfType(property.value as EsTreeNode, "AssignmentPattern")) return true;
  }
  return false;
};

// True when the default ObjectExpression supplies at least one concrete
// `key: value` fallback. A spread-only or empty object supplies no
// per-key default, so there is nothing to lose.
const objectDefaultSuppliesPerKeyValue = (
  objectExpression: EsTreeNodeOfType<"ObjectExpression">,
): boolean =>
  (objectExpression.properties ?? []).some((property) => isNodeOfType(property, "Property"));

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
      const defaultValue = node.right as EsTreeNode;
      if (!isNodeOfType(pattern, "ObjectPattern")) return;
      if (!isNodeOfType(defaultValue, "ObjectExpression")) return;
      if (!objectDefaultSuppliesPerKeyValue(defaultValue)) return;
      if (!hasBindingWithoutOwnDefault(pattern)) return;
      context.report({
        node,
        message:
          "This whole-object default is discarded the moment a caller passes any object, so every omitted key becomes undefined instead of falling back. Give each binding its own default instead: `({ a = 1, b = false } = {})`.",
      });
    },
  }),
});
