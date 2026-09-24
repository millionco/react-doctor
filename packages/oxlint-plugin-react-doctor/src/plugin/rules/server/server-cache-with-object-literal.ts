import { defineRule } from "../../utils/define-rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import {
  OBJECT_FREEZE_OR_SEAL_METHOD_NAMES,
  unwrapObjectIntegrityExpression,
} from "../../utils/unwrap-object-integrity-expression.js";
import { resolveImportedApiReference } from "../../utils/resolve-imported-api-reference.js";
import { resolveConstIdentifierAlias } from "../../utils/resolve-const-identifier-alias.js";

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
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      const cachedFunction = resolveConstIdentifierAlias(node.callee, context.scopes);
      if (cachedFunction?.kind !== "const") return;
      const initializer = cachedFunction.initializer;
      if (!isNodeOfType(initializer, "CallExpression") || initializer.arguments.length !== 1)
        return;
      const cacheReference = resolveImportedApiReference(initializer.callee, context.scopes);
      if (cacheReference?.source !== "react" || cacheReference.importedName !== "cache") return;
      const hasFreshArgument = node.arguments.some((argument) => {
        if (isNodeOfType(argument, "SpreadElement")) return false;
        const cacheKey = unwrapObjectIntegrityExpression(
          argument,
          context.scopes,
          OBJECT_FREEZE_OR_SEAL_METHOD_NAMES,
        );
        return (
          isNodeOfType(cacheKey, "ObjectExpression") || isNodeOfType(cacheKey, "ArrayExpression")
        );
      });
      if (!hasFreshArgument) return;
      context.report({
        node,
        message: `Passing a new object to React.cache() each render misses the cache, so it refetches every request.`,
      });
    },
  }),
});
