import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

// HACK: `cache(fn)` from React keys deduplication on REFERENCE equality
// of the function arguments. Calling the cached function with object
// literals (`getUser({ id: 1 })` then `getUser({ id: 1 })`) creates two
// distinct argument objects per render, so the cache never hits and the
// underlying fetch runs twice per request. Pass primitives (or memoize
// the argument object once at module/route scope).
export const serverCacheWithObjectLiteral = defineRule<Rule>({
  recommendation:
    "Pass primitives to React.cache()-wrapped functions — argument identity (not deep equality) is the dedup key, so a fresh `{}` per render bypasses the cache",
  create: (context: RuleContext) => {
    const cachedFunctionNames = new Set<string>();

    return {
      VariableDeclarator(node: EsTreeNode) {
        if (node.id?.type !== "Identifier") return;
        const init = node.init;
        if (init?.type !== "CallExpression") return;
        const callee = init.callee;
        const isCacheCall =
          (callee?.type === "Identifier" && callee.name === "cache") ||
          (callee?.type === "MemberExpression" &&
            callee.object?.type === "Identifier" &&
            callee.object.name === "React" &&
            callee.property?.type === "Identifier" &&
            callee.property.name === "cache");
        if (!isCacheCall) return;
        cachedFunctionNames.add(node.id.name);
      },
      CallExpression(node: EsTreeNode) {
        if (node.callee?.type !== "Identifier") return;
        if (!cachedFunctionNames.has(node.callee.name)) return;
        const firstArg = node.arguments?.[0];
        if (firstArg?.type !== "ObjectExpression") return;

        context.report({
          node,
          message: `${node.callee.name} is React.cache()-wrapped, but you're passing an object literal — the cache keys on argument identity, so a fresh {} per render bypasses dedup. Pass primitives or hoist the object`,
        });
      },
    };
  },
});
