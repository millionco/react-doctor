import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getRootIdentifierName } from "../../utils/get-root-identifier-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { RuleContext } from "../../utils/rule-context.js";

const GUARD_ANCESTOR_BUDGET = 12;
const GUARD_TEST_SCAN_BUDGET = 60;

const isMathMaxOrMinCallee = (callee: EsTreeNode): boolean =>
  isNodeOfType(callee, "MemberExpression") &&
  !callee.computed &&
  isNodeOfType(callee.object, "Identifier") &&
  callee.object.name === "Math" &&
  isNodeOfType(callee.property, "Identifier") &&
  (callee.property.name === "max" || callee.property.name === "min");

// The revision narrows scope: a `.filter(...)` chain (e.g.
// `[a, b].filter(isDefined)`) can preserve a guaranteed element, so
// spreading its result is not provably empty. Skip any chain that
// contains a `.filter` call rather than reasoning about it.
const chainContainsFilterCall = (node: EsTreeNode): boolean => {
  let cursor: EsTreeNode | null | undefined = node;
  while (cursor) {
    if (isNodeOfType(cursor, "ChainExpression")) {
      cursor = cursor.expression as EsTreeNode;
      continue;
    }
    if (isNodeOfType(cursor, "CallExpression")) {
      const callee = cursor.callee;
      if (
        isNodeOfType(callee, "MemberExpression") &&
        !callee.computed &&
        isNodeOfType(callee.property, "Identifier") &&
        callee.property.name === "filter"
      ) {
        return true;
      }
      cursor = callee as EsTreeNode;
      continue;
    }
    if (isNodeOfType(cursor, "MemberExpression")) {
      cursor = cursor.object as EsTreeNode;
      continue;
    }
    break;
  }
  return false;
};

// True when a guard test references either an `.length` read or the same
// base identifier as the spread array — `arr.length > 0`, `arr && ...`,
// `arr?.length`.
const testMentionsLengthOrName = (
  test: EsTreeNode,
  baseName: string | null
): boolean => {
  const stack: EsTreeNode[] = [test];
  let budget = GUARD_TEST_SCAN_BUDGET;
  while (stack.length > 0 && budget-- > 0) {
    const node = stack.pop()!;
    if (
      isNodeOfType(node, "MemberExpression") &&
      !node.computed &&
      isNodeOfType(node.property, "Identifier") &&
      node.property.name === "length"
    ) {
      return true;
    }
    if (baseName && isNodeOfType(node, "Identifier") && node.name === baseName)
      return true;
    const record = node as unknown as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (key === "parent") continue;
      const child = record[key];
      if (Array.isArray(child)) {
        for (const item of child) {
          if (item && typeof item === "object" && "type" in item)
            stack.push(item as EsTreeNode);
        }
      } else if (child && typeof child === "object" && "type" in child) {
        stack.push(child as EsTreeNode);
      }
    }
  }
  return false;
};

const isLengthGuarded = (
  mathCall: EsTreeNode,
  baseName: string | null
): boolean => {
  let child: EsTreeNode = mathCall;
  let parent = mathCall.parent ?? null;
  let steps = GUARD_ANCESTOR_BUDGET;
  while (parent && steps-- > 0) {
    if (isFunctionLike(parent)) break;
    if (
      isNodeOfType(parent, "ConditionalExpression") ||
      isNodeOfType(parent, "IfStatement")
    ) {
      if (
        (child === parent.consequent || child === parent.alternate) &&
        testMentionsLengthOrName(parent.test as EsTreeNode, baseName)
      ) {
        return true;
      }
    } else if (isNodeOfType(parent, "LogicalExpression")) {
      if (
        child === parent.right &&
        testMentionsLengthOrName(parent.left as EsTreeNode, baseName)
      ) {
        return true;
      }
    }
    child = parent;
    parent = parent.parent ?? null;
  }
  return false;
};

export const mathMaxMinSpreadUnguardedArray = defineRule({
  id: "math-max-min-spread-unguarded-array",
  title: "Math.max/min spread of a possibly-empty array",
  tags: ["test-noise"],
  severity: "warn",
  category: "Correctness",
  recommendation:
    "Spreading a possibly-empty array into `Math.max`/`Math.min` returns `-Infinity`/`Infinity`; guard the array's length or pass a scalar default like `Math.max(fallback, ...arr)`.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isMathMaxOrMinCallee(node.callee as EsTreeNode)) return;
      // Exactly one argument that is a spread — a scalar default like
      // `Math.max(0, ...arr)` or `Math.max(...arr, def)` guarantees a
      // finite result, so it never matches.
      if (node.arguments.length !== 1) return;
      const onlyArgument = node.arguments[0] as EsTreeNode;
      if (!isNodeOfType(onlyArgument, "SpreadElement")) return;

      const spreadValue = stripParenExpression(
        onlyArgument.argument as EsTreeNode
      );
      // A literal array (`Math.max(...[1, 2, 3])`) has a known extent.
      if (isNodeOfType(spreadValue, "ArrayExpression")) return;
      if (chainContainsFilterCall(spreadValue)) return;

      const baseName = getRootIdentifierName(spreadValue, {
        followCallChains: true,
      });
      if (isLengthGuarded(node as EsTreeNode, baseName)) return;

      context.report({
        node,
        message:
          "If this array is empty, `Math.max`/`Math.min` returns `-Infinity`/`Infinity` and silently corrupts the result — guard the array's length or pass a scalar default like `Math.max(fallback, ...arr)`.",
      });
    },
  }),
});
