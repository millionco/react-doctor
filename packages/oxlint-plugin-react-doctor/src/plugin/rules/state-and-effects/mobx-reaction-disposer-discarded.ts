import { defineRule } from "../../utils/define-rule.js";
import { getImportedNameFromModule } from "../../utils/find-import-source-for-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";

const MESSAGE =
  "This `reaction`/`autorun` returns a disposer you throw away, so the tracked computation runs for the lifetime of the process; keep the returned disposer and call it on teardown, or pass the call to `disposeOnUnmount`.";

// `when` auto-disposes after its predicate fires once, and `observe`/`intercept`
// are rare and easily confused with unrelated APIs — so only the two genuinely
// leak-prone MobX subscriptions are flagged.
const LEAKING_MOBX_SUBSCRIPTIONS = new Set(["reaction", "autorun"]);

export const mobxReactionDisposerDiscarded = defineRule({
  id: "mobx-reaction-disposer-discarded",
  title: "MobX reaction disposer discarded",
  severity: "warn",
  category: "Bugs",
  requires: ["mobx"],
  recommendation:
    "Store the disposer returned by `reaction`/`autorun` and call it on teardown, or pass the call to `disposeOnUnmount(this, ...)`.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      // Only a bare Identifier callee — this excludes Yup's `schema.when(...)`
      // and `observer.observe(...)`, which are MemberExpression callees.
      if (!isNodeOfType(node.callee, "Identifier")) return;
      const importedName = getImportedNameFromModule(
        node,
        node.callee.name,
        "mobx"
      );
      if (!importedName || !LEAKING_MOBX_SUBSCRIPTIONS.has(importedName))
        return;

      // The disposer is discarded only when the call is a standalone statement.
      // `const d = reaction(...)`, `this.x = reaction(...)`, and
      // `disposeOnUnmount(this, reaction(...))` all have non-statement parents.
      if (!isNodeOfType(node.parent, "ExpressionStatement")) return;

      context.report({ node, message: MESSAGE });
    },
  }),
});
