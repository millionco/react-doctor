import { DUPLICATE_STORAGE_READ_THRESHOLD, STORAGE_OBJECTS } from "../../constants.js";
import { defineRule } from "../../utils/define-rule.js";
import { isMemberProperty } from "../../utils/is-member-property.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

export const jsCacheStorage = defineRule<Rule>({
  recommendation:
    "Cache repeated `localStorage`/`sessionStorage` reads in a local variable — each access serializes/deserializes",
  create: (context: RuleContext) => {
    const storageReadCounts = new Map<string, number>();

    return {
      CallExpression(node: EsTreeNode) {
        if (!isMemberProperty(node.callee, "getItem")) return;
        if (
          node.callee.object?.type !== "Identifier" ||
          !STORAGE_OBJECTS.has(node.callee.object.name)
        )
          return;
        if (node.arguments?.[0]?.type !== "Literal") return;

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
