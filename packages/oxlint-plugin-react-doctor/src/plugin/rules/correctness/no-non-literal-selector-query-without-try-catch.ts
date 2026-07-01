import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { isInsideTryStatement } from "../../utils/is-inside-try-statement.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";

// Static property name of a member access (`a.b` / `a["b"]`), or null for a
// dynamic computed access (`a[key]`).
const getStaticMemberPropertyName = (node: EsTreeNode | null | undefined): string | null => {
  if (!node) return null;
  const unwrapped = stripParenExpression(node);
  if (!isNodeOfType(unwrapped, "MemberExpression")) return null;
  if (!unwrapped.computed && isNodeOfType(unwrapped.property, "Identifier")) {
    return unwrapped.property.name;
  }
  if (
    unwrapped.computed &&
    isNodeOfType(unwrapped.property, "Literal") &&
    typeof unwrapped.property.value === "string"
  ) {
    return unwrapped.property.value;
  }
  return null;
};

const MESSAGE =
  "This passes an href/hash-derived string to a `querySelector` call, which throws a `DOMException` on an invalid CSS selector instead of returning null. Wrap the call in try/catch or escape the value with `CSS.escape`.";

const SELECTOR_QUERY_METHOD_NAMES = new Set([
  "querySelector",
  "querySelectorAll",
  "matches",
  "closest",
]);
const HREF_ATTRIBUTE_NAMES = new Set(["href", "hash"]);
const HREF_HASH_FUNCTION_PATTERN = /href|hash/i;

const isHrefOrHashAttributeName = (value: unknown): boolean =>
  typeof value === "string" && HREF_ATTRIBUTE_NAMES.has(value);

// `el.getAttribute("href")` / `el.getAttribute("hash")`.
const isHrefGetAttributeCall = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  if (!isNodeOfType(node.callee, "MemberExpression")) return false;
  if (getStaticMemberPropertyName(node.callee) !== "getAttribute") return false;
  const firstArgument = node.arguments?.[0];
  return Boolean(
    firstArgument &&
    isNodeOfType(firstArgument, "Literal") &&
    isHrefOrHashAttributeName(firstArgument.value),
  );
};

// A member access whose property is `href`/`hash` (`el.href`, `location.hash`).
const isHrefHashMemberAccess = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "MemberExpression")) return false;
  const propertyName = getStaticMemberPropertyName(node);
  return Boolean(propertyName && HREF_ATTRIBUTE_NAMES.has(propertyName));
};

// A call to a helper named like `getHashFromHref` / `getHref` / `hashFor`.
const isHrefHashNamedCall = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  const callee = node.callee;
  if (isNodeOfType(callee, "Identifier")) return HREF_HASH_FUNCTION_PATTERN.test(callee.name);
  const propertyName = getStaticMemberPropertyName(callee);
  return Boolean(propertyName && HREF_HASH_FUNCTION_PATTERN.test(propertyName));
};

const isHrefHashDerivedExpression = (node: EsTreeNode): boolean => {
  const stripped = stripParenExpression(node);
  return (
    isHrefGetAttributeCall(stripped) ||
    isHrefHashMemberAccess(stripped) ||
    isHrefHashNamedCall(stripped)
  );
};

// The selector argument taints to an href/hash value: either directly, or
// through a same-file binding whose initializer is href/hash-derived.
const selectorArgumentTaintsToHref = (argument: EsTreeNode): boolean => {
  if (isHrefHashDerivedExpression(argument)) return true;
  const stripped = stripParenExpression(argument);
  if (!isNodeOfType(stripped, "Identifier")) return false;
  const binding = findVariableInitializer(stripped, stripped.name);
  return Boolean(binding?.initializer && isHrefHashDerivedExpression(binding.initializer));
};

const isStringLiteralSelector = (argument: EsTreeNode): boolean => {
  const stripped = stripParenExpression(argument);
  if (isNodeOfType(stripped, "Literal")) return typeof stripped.value === "string";
  return isNodeOfType(stripped, "TemplateLiteral") && stripped.expressions.length === 0;
};

// Flags `document.querySelector(x)` / `querySelectorAll` / `Element.matches` /
// `closest` when the selector argument taints to an anchor href/hash value and
// the call is not inside try/catch. The query throws a `DOMException` on an
// invalid selector, so an href fragment like `#section 1` crashes the handler.
//
// v1 scope: only the high-confidence href/hash sink fires. String literals,
// CSS-module templates, `CSS.escape` outputs, SCREAMING_SNAKE selector
// constants, and opaque `props.*Selector` config values are intentionally quiet.
export const noNonLiteralSelectorQueryWithoutTryCatch = defineRule({
  id: "no-non-literal-selector-query-without-try-catch",
  title: "Unguarded querySelector with href-derived selector",
  severity: "warn",
  category: "Correctness",
  recommendation:
    "`querySelector`/`querySelectorAll`/`matches`/`closest` throw a `DOMException` on an invalid CSS selector, and href/hash fragments are frequently invalid. Wrap the call in try/catch or normalize the value with `CSS.escape`.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      const callee = node.callee;
      if (!isNodeOfType(callee, "MemberExpression")) return;
      const methodName = getStaticMemberPropertyName(callee);
      if (!methodName || !SELECTOR_QUERY_METHOD_NAMES.has(methodName)) return;
      const selectorArgument = node.arguments?.[0];
      if (!selectorArgument || isNodeOfType(selectorArgument, "SpreadElement")) return;
      if (isStringLiteralSelector(selectorArgument)) return;
      if (!selectorArgumentTaintsToHref(selectorArgument)) return;
      if (isInsideTryStatement(node as EsTreeNode, { region: "block" })) return;
      context.report({ node, message: MESSAGE });
    },
  }),
});
