import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";

const MESSAGE =
  "`JSON.parse(JSON.stringify(x))` deep-clones by re-serializing: it is slow on large objects and silently drops `undefined`, functions, `Date`/`Map`/`Set`, and cyclic references. Use `structuredClone(x)`.";

// `JSON.<method>(...)` with a non-computed `JSON` member callee. Computed
// access (`JSON["parse"]`) is a v1 non-goal: it is vanishingly rare and
// keeping the matcher to plain member access avoids over-reaching.
const isJsonMethodCall = (
  node: EsTreeNode,
  method: string,
): node is EsTreeNodeOfType<"CallExpression"> => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  const callee = node.callee;
  return (
    isNodeOfType(callee, "MemberExpression") &&
    !callee.computed &&
    isNodeOfType(callee.object, "Identifier") &&
    callee.object.name === "JSON" &&
    isNodeOfType(callee.property, "Identifier") &&
    callee.property.name === method
  );
};

export const noJsonParseStringifyClone = defineRule({
  id: "no-json-parse-stringify-clone",
  title: "JSON parse/stringify deep clone",
  severity: "warn",
  recommendation:
    "Replace `JSON.parse(JSON.stringify(value))` with `structuredClone(value)`. It is faster and preserves Dates, Maps, Sets, and cyclic references.",
  create: (context) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isJsonMethodCall(node, "parse")) return;
      const firstArgument = node.arguments?.[0];
      if (!firstArgument || !isJsonMethodCall(firstArgument, "stringify")) return;
      context.report({ node, message: MESSAGE });
    },
  }),
});
