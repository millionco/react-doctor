import { defineRule } from "../../utils/define-rule.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";

const DEPENDENCY_ARRAY_HOOK_NAMES = new Set([
  "useEffect",
  "useLayoutEffect",
  "useMemo",
  "useCallback",
  "useImperativeHandle",
]);

// `JSON.stringify(...)` as a static (non-computed) member call, so
// `JSON["stringify"](x)` and `stringify(x)` (a different binding) never match.
const isJsonStringifyCall = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  const callee = node.callee;
  if (!isNodeOfType(callee, "MemberExpression") || callee.computed) return false;
  return (
    isNodeOfType(callee.object, "Identifier") &&
    callee.object.name === "JSON" &&
    isNodeOfType(callee.property, "Identifier") &&
    callee.property.name === "stringify"
  );
};

// Flags `JSON.stringify(...)` used as a DIRECT element of the dependency
// array (the last argument) of a React hook. Serializing an object into a
// single string dep masks the effect's real reactive reads from
// exhaustive-deps, re-serializes every render, and is an unsound equality
// key (functions/`undefined` dropped, `Date`s stringified, key order
// unstable). Only the AST-scoped dep-array element matches, so template
// strings and non-hook array literals stay quiet.
export const noJsonStringifyInHookDependencyArray = defineRule({
  id: "no-json-stringify-in-hook-dependency-array",
  title: "JSON.stringify in a hook dependency array",
  severity: "warn",
  category: "Correctness",
  recommendation:
    "A `JSON.stringify(...)` dependency masks the effect's other reactive reads from exhaustive-deps, re-serializes on every render, and is an unsound equality key (functions and dates do not round-trip). List the actual reactive values as deps, or compute a stable key outside the array.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isHookCall(node, DEPENDENCY_ARRAY_HOOK_NAMES)) return;
      const args = node.arguments ?? [];
      if (args.length < 2) return;
      const depsNode = stripParenExpression(args[args.length - 1]);
      if (!isNodeOfType(depsNode, "ArrayExpression")) return;
      for (const element of depsNode.elements ?? []) {
        if (!element) continue;
        const dep = stripParenExpression(element);
        if (!isJsonStringifyCall(dep)) continue;
        context.report({
          node: dep,
          message:
            "This uses `JSON.stringify(...)` as a hook dependency, which hides the effect's real reactive reads from exhaustive-deps, re-serializes every render, and is an unsound equality key. Depend on the actual reactive values instead.",
        });
      }
    },
  }),
});
