import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripGroupingParens } from "../../utils/strip-grouping-parens.js";
import type { RuleContext } from "../../utils/rule-context.js";

const MESSAGE =
  "This `as` assertion drops `null`/`undefined` from a value that is genuinely nullable and then immediately uses the result, so the `undefined` still flows at runtime — interpolating the literal string `'undefined'` or throwing on dereference. Handle the nullish case (optional chaining, `?? fallback`, or a guard) instead of asserting it away.";

const NULLISH_KEYWORD_TYPES = new Set(["TSNullKeyword", "TSUndefinedKeyword"]);

// oxc-parser surfaces `(...)` as a `ParenthesizedExpression`, a node
// kind outside the TSESTree union, so it is matched by string here.
const PARENTHESIZED_EXPRESSION_TYPE: string = "ParenthesizedExpression";

// The target type keeps nullability, is a launder target, or is
// `as const` — none of which widen a nullable value away unsoundly.
const targetIsExcluded = (target: EsTreeNode | undefined): boolean => {
  if (!target) return true;
  if (target.type === "TSUnknownKeyword" || target.type === "TSAnyKeyword")
    return true;
  if (NULLISH_KEYWORD_TYPES.has(target.type)) return true;
  if (
    isNodeOfType(target, "TSTypeReference") &&
    isNodeOfType(target.typeName, "Identifier")
  ) {
    if (target.typeName.name === "const") return true;
  }
  if (isNodeOfType(target, "TSUnionType")) {
    return (target.types ?? []).some((member) =>
      NULLISH_KEYWORD_TYPES.has((member as EsTreeNode).type)
    );
  }
  return false;
};

// Branch A: the operand carries top-level optional chaining, so it is
// provably `T | undefined` from syntax alone (no type info needed).
const operandHasOptionalChaining = (operand: EsTreeNode): boolean => {
  if (isNodeOfType(operand, "ChainExpression")) return true;
  if (
    (isNodeOfType(operand, "MemberExpression") ||
      isNodeOfType(operand, "CallExpression")) &&
    operand.optional
  ) {
    return true;
  }
  return false;
};

// Branch B: the operand is an identifier whose in-file declaration is
// annotated with an explicit `X | null | undefined` union.
const identifierHasNullableAnnotation = (operand: EsTreeNode): boolean => {
  if (!isNodeOfType(operand, "Identifier")) return false;
  const binding = findVariableInitializer(operand, operand.name);
  if (!binding || !isNodeOfType(binding.bindingIdentifier, "Identifier"))
    return false;
  const annotation = binding.bindingIdentifier.typeAnnotation;
  if (!annotation) return false;
  const annotatedType = (annotation as { typeAnnotation?: EsTreeNode })
    .typeAnnotation;
  if (!annotatedType || !isNodeOfType(annotatedType, "TSUnionType"))
    return false;
  return (annotatedType.types ?? []).some((member) =>
    NULLISH_KEYWORD_TYPES.has((member as EsTreeNode).type)
  );
};

// Walk past grouping parens to the node the syntactic parent actually
// consumes, so `(x?.y as T)?.z` and `(x?.y as T) ?? z` are seen
// through the parens.
const getConsumingContext = (
  node: EsTreeNode
): { parent: EsTreeNode | null; child: EsTreeNode } => {
  let child: EsTreeNode = node;
  let parent = node.parent ?? null;
  while (parent && parent.type === PARENTHESIZED_EXPRESSION_TYPE) {
    child = parent;
    parent = parent.parent ?? null;
  }
  return { parent, child };
};

// Flags a single `expr as T` assertion whose operand is genuinely
// nullable (top-level optional chaining, or an identifier annotated
// `X | null | undefined`) but whose target `T` excludes null/undefined,
// AND whose result is immediately template-interpolated, passed as a
// JSX prop, or dereferenced. A trailing `?.` / `?? fallback` re-guards
// the value and is excluded; `!`, `as unknown`/`as any`/`as const`, and
// nullable targets are excluded by construction.
export const noTypeAssertionWideningAwayNullOrUndefined = defineRule({
  id: "no-type-assertion-widening-away-null-or-undefined",
  title: "Assertion widens away null or undefined",
  severity: "warn",
  category: "Correctness",
  tags: ["test-noise"],
  recommendation:
    "Asserting `expr?.member as T` (or a nullable identifier `as T`) erases the compiler's knowledge that the value can be nullish without changing the runtime value, so the `undefined` still interpolates as `'undefined'` or throws on deref. Handle the nullish case with optional chaining, `?? fallback`, or a guard.",
  create: (context: RuleContext) => ({
    TSAsExpression(node: EsTreeNodeOfType<"TSAsExpression">) {
      if (targetIsExcluded(node.typeAnnotation as EsTreeNode)) return;

      const operand = stripGroupingParens(node.expression as EsTreeNode);
      if (
        !operandHasOptionalChaining(operand) &&
        !identifierHasNullableAnnotation(operand)
      )
        return;

      const { parent, child } = getConsumingContext(node as EsTreeNode);
      if (!parent) return;

      // Re-guarded by a trailing `?.` or recovered by a following `??`.
      if (
        isNodeOfType(parent, "MemberExpression") &&
        parent.object === child &&
        parent.optional
      )
        return;
      if (
        isNodeOfType(parent, "LogicalExpression") &&
        parent.operator === "??" &&
        parent.left === child
      ) {
        return;
      }

      const isTemplateInterpolation = isNodeOfType(parent, "TemplateLiteral");
      const isJsxProp =
        isNodeOfType(parent, "JSXExpressionContainer") &&
        isNodeOfType(parent.parent, "JSXAttribute");
      const isDereference =
        isNodeOfType(parent, "MemberExpression") &&
        parent.object === child &&
        !parent.optional;

      if (isTemplateInterpolation || isJsxProp || isDereference) {
        context.report({ node: node as EsTreeNode, message: MESSAGE });
      }
    },
  }),
});
