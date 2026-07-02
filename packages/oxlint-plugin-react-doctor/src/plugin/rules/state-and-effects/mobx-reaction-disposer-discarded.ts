import { defineRule } from "../../utils/define-rule.js";
import {
  getImportedNameFromModule,
  isNamespaceImportFromModule,
} from "../../utils/find-import-source-for-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";

const MESSAGE =
  "This `reaction`/`autorun` returns a disposer you throw away, so the tracked computation runs for the lifetime of the process; keep the returned disposer and call it on teardown, or pass the call to `disposeOnUnmount`.";

// `when` auto-disposes after its predicate fires once, and `observe`/`intercept`
// are rare and easily confused with unrelated APIs — so only the two genuinely
// leak-prone MobX subscriptions are flagged.
const LEAKING_MOBX_SUBSCRIPTIONS = new Set(["reaction", "autorun"]);

const OPTIONS_ARGUMENT_INDEX: Record<string, number> = { autorun: 1, reaction: 2 };

const resolveLeakingSubscriptionName = (
  node: EsTreeNodeOfType<"CallExpression">,
): string | null => {
  if (isNodeOfType(node.callee, "Identifier")) {
    const importedName = getImportedNameFromModule(node, node.callee.name, "mobx");
    if (importedName && LEAKING_MOBX_SUBSCRIPTIONS.has(importedName)) return importedName;
    return null;
  }
  // `mobx.autorun(...)` on a verified `import * as mobx from "mobx"` binding —
  // this still excludes Yup's `schema.when(...)` and `observer.observe(...)`.
  if (
    isNodeOfType(node.callee, "MemberExpression") &&
    !node.callee.computed &&
    isNodeOfType(node.callee.object, "Identifier") &&
    isNodeOfType(node.callee.property, "Identifier") &&
    LEAKING_MOBX_SUBSCRIPTIONS.has(node.callee.property.name) &&
    isNamespaceImportFromModule(node, node.callee.object.name, "mobx")
  ) {
    return node.callee.property.name;
  }
  return null;
};

const mayCarryAbortSignal = (optionsArgument: unknown): boolean => {
  if (!optionsArgument) return false;
  if (!isNodeOfType(optionsArgument, "ObjectExpression")) return true;
  return optionsArgument.properties.some((property) => {
    if (!isNodeOfType(property, "Property")) return true;
    if (property.computed) return true;
    if (isNodeOfType(property.key, "Identifier")) return property.key.name === "signal";
    if (isNodeOfType(property.key, "Literal")) return property.key.value === "signal";
    return true;
  });
};

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
      const subscriptionName = resolveLeakingSubscriptionName(node);
      if (!subscriptionName) return;

      // The disposer is discarded only when the call is a standalone statement.
      // `const d = reaction(...)`, `this.x = reaction(...)`, and
      // `disposeOnUnmount(this, reaction(...))` all have non-statement parents.
      if (!isNodeOfType(node.parent, "ExpressionStatement")) return;

      // A `signal` option is MobX's documented alternative disposal mechanism,
      // so discarding the disposer is correct there; opaque (non-literal)
      // options may carry one, so they get the benefit of the doubt.
      const optionsArgument = node.arguments[OPTIONS_ARGUMENT_INDEX[subscriptionName]];
      if (mayCarryAbortSignal(optionsArgument)) return;

      context.report({ node, message: MESSAGE });
    },
  }),
});
