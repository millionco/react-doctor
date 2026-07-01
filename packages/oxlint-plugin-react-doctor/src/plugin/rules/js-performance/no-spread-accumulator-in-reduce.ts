import { FUNCTION_LIKE_TYPES } from "../../constants/js.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isAstNode } from "../../utils/is-ast-node.js";
import { isMemberProperty } from "../../utils/is-member-property.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";

const REDUCE_METHOD_NAMES = new Set(["reduce", "reduceRight"]);

// Collects the object/array literals a reducer callback returns — the
// concise-body expression, or every top-level `return X`. Stops at
// nested function boundaries so an inner callback's return isn't
// mistaken for the reducer's own.
const collectReturnedLiterals = (
  callback: EsTreeNodeOfType<"ArrowFunctionExpression"> | EsTreeNodeOfType<"FunctionExpression">,
): EsTreeNode[] => {
  const literals: EsTreeNode[] = [];
  const collectIfLiteral = (expression: EsTreeNode | null | undefined): void => {
    if (!expression) return;
    const stripped = stripParenExpression(expression);
    if (isNodeOfType(stripped, "ObjectExpression") || isNodeOfType(stripped, "ArrayExpression")) {
      literals.push(stripped);
    }
  };

  const body = callback.body;
  if (!body) return literals;
  if (!isNodeOfType(body, "BlockStatement")) {
    collectIfLiteral(body);
    return literals;
  }

  const visit = (node: EsTreeNode): void => {
    if (isNodeOfType(node, "ReturnStatement")) {
      collectIfLiteral(node.argument);
      return;
    }
    const nodeRecord = node as unknown as Record<string, unknown>;
    for (const key of Object.keys(nodeRecord)) {
      if (key === "parent") continue;
      const child = nodeRecord[key];
      if (Array.isArray(child)) {
        for (const item of child) {
          if (isAstNode(item) && !FUNCTION_LIKE_TYPES.has(item.type)) visit(item);
        }
      } else if (isAstNode(child) && !FUNCTION_LIKE_TYPES.has(child.type)) {
        visit(child);
      }
    }
  };
  visit(body);
  return literals;
};

// The literal's first spread — `{ ...x, ... }` / `[ ...x, y ]`. Returns
// the spread's argument expression, or null when the literal has no
// spread as its leading element.
const firstSpreadArgument = (literal: EsTreeNode): EsTreeNode | null => {
  const members = isNodeOfType(literal, "ObjectExpression")
    ? literal.properties
    : isNodeOfType(literal, "ArrayExpression")
      ? literal.elements
      : null;
  if (!members) return null;
  for (const member of members) {
    if (!member) continue;
    if (isNodeOfType(member as EsTreeNode, "SpreadElement")) {
      return (member as EsTreeNodeOfType<"SpreadElement">).argument;
    }
  }
  return null;
};

// The O(n²) premise only holds when the accumulator actually grows every step.
// An array literal always appends. An object literal grows only when it adds an
// unbounded key set — a computed `[expr]: v` key or a second spread; a
// fixed-shape merge of static named keys (`{ ...acc, city: component }`) keeps
// the accumulator bounded, so copying it stays O(1)/step (O(n) total).
const literalGrowsAccumulatorPerIteration = (literal: EsTreeNode): boolean => {
  if (isNodeOfType(literal, "ArrayExpression")) return true;
  if (!isNodeOfType(literal, "ObjectExpression")) return false;
  let spreadCount = 0;
  for (const property of literal.properties) {
    if (!property) continue;
    const member = property as EsTreeNode;
    if (isNodeOfType(member, "SpreadElement")) {
      spreadCount += 1;
      if (spreadCount >= 2) return true;
      continue;
    }
    if (isNodeOfType(member, "Property") && member.computed) return true;
  }
  return false;
};

export const noSpreadAccumulatorInReduce = defineRule({
  id: "no-spread-accumulator-in-reduce",
  title: "Accumulator spread in reduce is quadratic",
  tags: ["test-noise"],
  severity: "warn",
  category: "Performance",
  recommendation:
    "Mutate the accumulator and return it (`acc[key] = value; return acc`) so the fold stays O(n) instead of copying the whole accumulator every step.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      const callee = node.callee;
      if (!isMemberProperty(callee, "reduce") && !isMemberProperty(callee, "reduceRight")) {
        return;
      }
      if (!isNodeOfType(callee, "MemberExpression")) return;
      if (!isNodeOfType(callee.property, "Identifier")) return;
      if (!REDUCE_METHOD_NAMES.has(callee.property.name)) return;

      const callback = node.arguments?.[0];
      if (
        !callback ||
        (!isNodeOfType(callback, "ArrowFunctionExpression") &&
          !isNodeOfType(callback, "FunctionExpression"))
      ) {
        return;
      }
      const accumulatorParam = callback.params?.[0];
      if (!accumulatorParam || !isNodeOfType(accumulatorParam, "Identifier")) return;
      const accumulatorName = accumulatorParam.name;

      for (const literal of collectReturnedLiterals(callback)) {
        const spreadArgument = firstSpreadArgument(literal);
        if (
          spreadArgument &&
          isNodeOfType(spreadArgument, "Identifier") &&
          spreadArgument.name === accumulatorName &&
          literalGrowsAccumulatorPerIteration(literal)
        ) {
          context.report({
            node: literal,
            message:
              "This is O(n²) because spreading the accumulator copies the entire growing collection every step. Mutate and return the accumulator instead (acc[key] = value; return acc).",
          });
          return;
        }
      }
    },
  }),
});
