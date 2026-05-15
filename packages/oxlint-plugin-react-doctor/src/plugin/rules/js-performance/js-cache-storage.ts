import { STORAGE_OBJECTS } from "../../constants/dom.js";
import { DUPLICATE_STORAGE_READ_THRESHOLD } from "../../constants/thresholds.js";
import { defineRule } from "../../utils/define-rule.js";
import { isMemberProperty } from "../../utils/is-member-property.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const jsCacheStorage = defineRule<Rule>({
  id: "js-cache-storage",
  severity: "warn",
  recommendation:
    "Cache repeated `localStorage`/`sessionStorage` reads in a local variable — each access serializes/deserializes",
  create: (context: RuleContext) => {
    const storageReadCounts = new Map<string, number>();

    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (!isMemberProperty(node.callee, "getItem")) return;
        if (
          !isNodeOfType(node.callee.object, "Identifier") ||
          !STORAGE_OBJECTS.has(node.callee.object.name)
        )
          return;
        if (!isNodeOfType(node.arguments?.[0], "Literal")) return;

        const storageKey = String(node.arguments[0].value);
        const readCount = (storageReadCounts.get(storageKey) ?? 0) + 1;
        storageReadCounts.set(storageKey, readCount);

        if (readCount === DUPLICATE_STORAGE_READ_THRESHOLD) {
          const storageName = node.callee.object.name;
          context.report({
            node,
            message: `${storageName}.getItem("${storageKey}") called multiple times — cache the result in a variable`,
          });
        }
      },
    };
  },
});
