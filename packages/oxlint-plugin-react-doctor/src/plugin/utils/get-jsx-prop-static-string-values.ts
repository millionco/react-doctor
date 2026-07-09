import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getStaticTemplateLiteralValue } from "./get-static-template-literal-value.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";

// Chains like `const a = "x"; const role = a;` resolve one hop at a
// time; the cap keeps a pathological alias chain from walking forever.
const MAX_CONST_RESOLUTION_HOPS = 4;

const resolveStaticStringValues = (
  rawExpression: EsTreeNode,
  scopes: ScopeAnalysis,
  remainingHops: number,
): ReadonlyArray<string> | null => {
  const expression = stripParenExpression(rawExpression);
  if (isNodeOfType(expression, "Literal")) {
    return typeof expression.value === "string" ? [expression.value] : null;
  }
  if (isNodeOfType(expression, "TemplateLiteral")) {
    const staticValue = getStaticTemplateLiteralValue(expression);
    return staticValue === null ? null : [staticValue];
  }
  if (isNodeOfType(expression, "ConditionalExpression")) {
    const consequentValues = resolveStaticStringValues(
      expression.consequent,
      scopes,
      remainingHops,
    );
    if (consequentValues === null) return null;
    const alternateValues = resolveStaticStringValues(expression.alternate, scopes, remainingHops);
    if (alternateValues === null) return null;
    return [...consequentValues, ...alternateValues];
  }
  if (isNodeOfType(expression, "Identifier")) {
    if (remainingHops === 0) return null;
    const symbol = scopes.referenceFor(expression)?.resolvedSymbol;
    // Only `const` bindings are safe to inline — anything reassignable
    // (or an import/parameter, whose value we can't see) stays dynamic.
    if (!symbol || symbol.kind !== "const" || !symbol.initializer) return null;
    return resolveStaticStringValues(symbol.initializer, scopes, remainingHops - 1);
  }
  return null;
};

// Static-resolution big brother of `getJsxPropStringValue`: returns EVERY
// string the attribute can statically evaluate to, or null when any
// possible value is dynamic/unknown. Beyond the plain string literal it
// resolves expression containers holding a string literal, a static
// template literal, a ternary whose branches both resolve (contributing
// both), and an identifier bound by a `const` whose initializer resolves —
// so `role={isChecked ? "checkbox" : "radio"}` and
// `const ROLE = "button"; … role={ROLE}` stop reading as "dynamic, assumed
// valid". Callers decide the aggregation policy: a correctness rule may
// report when ANY candidate is invalid (that branch is a bug when taken),
// a rule whose claim must hold unconditionally should require ALL
// candidates to violate.
export const getJsxPropStaticStringValues = (
  attribute: EsTreeNodeOfType<"JSXAttribute">,
  scopes: ScopeAnalysis,
): ReadonlyArray<string> | null => {
  const value = attribute.value;
  if (!value) return null;
  if (isNodeOfType(value, "Literal")) {
    return typeof value.value === "string" ? [value.value] : null;
  }
  if (isNodeOfType(value, "JSXExpressionContainer")) {
    return resolveStaticStringValues(
      value.expression as EsTreeNode,
      scopes,
      MAX_CONST_RESOLUTION_HOPS,
    );
  }
  return null;
};
