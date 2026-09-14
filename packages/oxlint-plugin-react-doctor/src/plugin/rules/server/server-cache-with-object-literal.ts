import { defineRule } from "../../utils/define-rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import {
  OBJECT_FREEZE_OR_SEAL_METHOD_NAMES,
  unwrapObjectIntegrityExpression,
} from "../../utils/unwrap-object-integrity-expression.js";
import { resolveImportedApiReference } from "../../utils/resolve-imported-api-reference.js";
import { collectBindingAliases } from "../../utils/collect-binding-aliases.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";

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
    const cachedFunctionBindings = new Set<EsTreeNode>();

    return {
      VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
        if (!isNodeOfType(node.id, "Identifier")) return;
        const init = node.init;
        if (!isNodeOfType(init, "CallExpression")) return;
        if (init.arguments.length !== 1) return;
        
        const importedRef = resolveImportedApiReference(init.callee, context.scopes);
        if (!importedRef || importedRef.source !== "react" || importedRef.importedName !== "cache") {
          return;
        }

        const aliases = collectBindingAliases(node.id, context.scopes);
        for (const alias of aliases) {
          cachedFunctionBindings.add(alias);
        }
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (cachedFunctionBindings.size === 0) return;
        if (!isNodeOfType(node.callee, "Identifier")) return;
        
        const calleeSymbol = context.scopes.symbolFor(node.callee);
        if (!calleeSymbol) return;
        const isCachedFunction = cachedFunctionBindings.has(calleeSymbol.bindingIdentifier);
        if (!isCachedFunction) return;

        let hasFreshObjectOrArray = false;
        for (const argument of node.arguments ?? []) {
          if (isNodeOfType(argument, "SpreadElement")) continue;
          const cacheKey = unwrapObjectIntegrityExpression(
            argument,
            context.scopes,
            OBJECT_FREEZE_OR_SEAL_METHOD_NAMES,
          );
          if (isNodeOfType(cacheKey, "ObjectExpression") || isNodeOfType(cacheKey, "ArrayExpression")) {
            hasFreshObjectOrArray = true;
            break;
          }
        }

        if (!hasFreshObjectOrArray) return;

        context.report({
          node,
          message: `Passing a new object to React.cache() each render misses the cache, so it refetches every request.`,
        });
      },
    };
  },
});
