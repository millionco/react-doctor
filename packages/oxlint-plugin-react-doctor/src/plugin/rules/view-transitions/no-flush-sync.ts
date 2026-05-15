import { defineRule } from "../../utils/define-rule.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { getImportedName } from "../../utils/get-imported-name.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// HACK: `flushSync` from react-dom forces a synchronous flush, which
// skips the View Transition snapshot phase entirely — any animation that
// would have triggered is silently dropped. We report only on the import
// (a single actionable diagnostic per file) instead of on every call
// site, which would clutter output for files with several flushSync()s.
export const noFlushSync = defineRule<Rule>({
  id: "no-flush-sync",
  severity: "warn",
  category: "Performance",
  recommendation:
    "Use startTransition for non-urgent updates — flushSync forces a sync flush that skips View Transitions and concurrent rendering",
  create: (context: RuleContext) => ({
    ImportDeclaration(node: EsTreeNodeOfType<"ImportDeclaration">) {
      if (node.source?.value !== "react-dom") return;
      for (const specifier of node.specifiers ?? []) {
        if (!isNodeOfType(specifier, "ImportSpecifier")) continue;
        if (getImportedName(specifier) === "flushSync") {
          context.report({
            node: specifier,
            message:
              "flushSync from react-dom skips View Transition snapshots and concurrent rendering — prefer startTransition for non-urgent updates",
          });
        }
      }
    },
  }),
});
