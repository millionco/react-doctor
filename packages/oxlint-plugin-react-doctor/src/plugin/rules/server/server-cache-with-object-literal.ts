import { defineRule } from "../../utils/define-rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import {
  OBJECT_FREEZE_OR_SEAL_METHOD_NAMES,
  unwrapObjectIntegrityExpression,
} from "../../utils/unwrap-object-integrity-expression.js";

// HACK: `cache(fn)` from React keys deduplication on REFERENCE equality
// of the function arguments. Calling the cached function with object
// literals (`getUser({ id: 1 })` then `getUser({ id: 1 })`) creates two
// distinct argument objects per render, so the cache never hits and the
// underlying fetch runs twice per request. Pass primitives (or memoize
// the argument object once at module/route scope).
export const serverCacheWithObjectLiteral = defineRule({
  id: "server-cache-with-object-literal",
  title: "React.cache with object literal",
  tags: ["test-noise"],
  severity: "warn",
  recommendation:
    "Pass plain values like strings or numbers, not an object. React.cache() matches the exact value, so a new `{}` each render misses the cache.",
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
        if (cachedFunctionNames.size === 0) return;
        if (!isNodeOfType(node.callee, "Identifier")) return;
        if (!cachedFunctionNames.has(node.callee.name)) return;
        const firstArg = node.arguments?.[0];
        if (!firstArg || isNodeOfType(firstArg, "SpreadElement")) return;
        const cacheKey = unwrapObjectIntegrityExpression(
          firstArg,
          context.scopes,
          OBJECT_FREEZE_OR_SEAL_METHOD_NAMES,
        );
        if (!isNodeOfType(cacheKey, "ObjectExpression")) return;

        context.report({
          node,
          message: `Passing a new object to React.cache() each render misses the cache, so it refetches every request.`,
        });
      },
    };
  },
});
