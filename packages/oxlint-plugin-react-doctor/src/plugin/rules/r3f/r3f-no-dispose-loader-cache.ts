import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { resolvesToLoaderCacheValue } from "./utils/resolve-loader-cache-provenance.js";

export const r3fNoDisposeLoaderCache = defineRule({
  id: "r3f-no-dispose-loader-cache",
  title: "Disposal of a cached R3F loader asset",
  category: "Correctness",
  severity: "warn",
  recommendation: "Do not dispose assets returned by cached R3F and Drei loader hooks",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (
        !isNodeOfType(node.callee, "MemberExpression") ||
        getStaticPropertyName(node.callee) !== "dispose" ||
        !resolvesToLoaderCacheValue(node.callee.object, context.scopes)
      ) {
        return;
      }
      context.report({
        node,
        message:
          "This disposes an asset shared by the R3F loader cache, which can break other consumers of the same asset. Leave cached loader assets managed by the cache",
      });
    },
  }),
});
