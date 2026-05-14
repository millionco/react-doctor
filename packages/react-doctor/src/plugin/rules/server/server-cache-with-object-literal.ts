import { defineRule } from "../../utils/define-rule.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// HACK: `cache(fn)` from React keys deduplication on REFERENCE equality
// of the function arguments. Calling the cached function with object
// literals (`getUser({ id: 1 })` then `getUser({ id: 1 })`) creates two
// distinct argument objects per render, so the cache never hits and the
// underlying fetch runs twice per request. Pass primitives (or memoize
// the argument object once at module/route scope).
export const serverCacheWithObjectLiteral = defineRule<Rule>({
  id: "server-cache-with-object-literal",
  framework: "global",
  severity: "warn",
  category: "Server",
  recommendation:
    "Pass primitives to React.cache()-wrapped functions — argument identity (not deep equality) is the dedup key, so a fresh `{}` per render bypasses the cache",
  examples: [
    {
      before:
        "const getUser = cache(async (opts) => db.users.find(opts));\ngetUser({ id: userId });",
      after:
        "const getUser = cache(async (id: string) => db.users.findById(id));\ngetUser(userId);",
    },
  ],
  create: (context: RuleContext) => {
    const cachedFunctionNames = new Set<string>();

    return {
      VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
        if (!isNodeOfType(node.id, "Identifier")) return;
        const init = node.init;
        if (!isNodeOfType(init, "CallExpression")) return;
        const callee = init.callee;
        const isCacheCall =
          (isNodeOfType(callee, "Identifier") && callee.name === "cache") ||
          (isNodeOfType(callee, "MemberExpression") &&
            isNodeOfType(callee.object, "Identifier") &&
            callee.object.name === "React" &&
            isNodeOfType(callee.property, "Identifier") &&
            callee.property.name === "cache");
        if (!isCacheCall) return;
        cachedFunctionNames.add(node.id.name);
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (!isNodeOfType(node.callee, "Identifier")) return;
        if (!cachedFunctionNames.has(node.callee.name)) return;
        const firstArg = node.arguments?.[0];
        if (!isNodeOfType(firstArg, "ObjectExpression")) return;

        context.report({
          node,
          message: `${node.callee.name} is React.cache()-wrapped, but you're passing an object literal — the cache keys on argument identity, so a fresh {} per render bypasses dedup. Pass primitives or hoist the object`,
        });
      },
    };
  },
});
