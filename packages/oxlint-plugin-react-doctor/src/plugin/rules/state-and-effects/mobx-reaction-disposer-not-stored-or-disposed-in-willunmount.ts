import { defineRule } from "../../utils/define-rule.js";
import { getImportedNameFromModule } from "../../utils/find-import-source-for-name.js";
import { isEs6Component } from "../../utils/is-es6-component.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";

const MESSAGE =
  "This `reaction`/`autorun`/`when` is a class-field initializer, so it runs before the component mounts; move it into `componentDidMount` and wrap it in `disposeOnUnmount(this, ...)` so mount/unmount ordering stays correct.";

const REACTIVE_SUBSCRIPTIONS = new Set(["reaction", "autorun", "when"]);

const getEnclosingEs6Component = (node: EsTreeNode): EsTreeNode | null => {
  let cursor: EsTreeNode | null | undefined = node.parent;
  while (cursor) {
    if (isEs6Component(cursor)) return cursor;
    cursor = cursor.parent ?? null;
  }
  return null;
};

// A field-initializer disposer is `private x = reaction(...)` — the call's
// direct parent is the PropertyDefinition. `disposeOnUnmount(this, reaction())`
// and `this.x = reaction()` (assignment in a method) have other parents and
// are handled elsewhere / are already correct.
const isFieldInitializer = (node: EsTreeNode): boolean =>
  isNodeOfType(node.parent, "PropertyDefinition") && node.parent.value === node;

export const mobxReactionDisposerNotStoredOrDisposedInWillunmount = defineRule({
  id: "mobx-reaction-disposer-not-stored-or-disposed-in-willunmount",
  title: "MobX reaction stored as a field instead of disposeOnUnmount",
  severity: "warn",
  category: "Bugs",
  requires: ["react", "mobx"],
  recommendation:
    "Create `reaction`/`autorun`/`when` in `componentDidMount` and wrap it in `disposeOnUnmount(this, ...)` instead of initializing it as a class field disposed in `componentWillUnmount`.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isNodeOfType(node.callee, "Identifier")) return;
      const importedName = getImportedNameFromModule(
        node,
        node.callee.name,
        "mobx"
      );
      if (!importedName || !REACTIVE_SUBSCRIPTIONS.has(importedName)) return;

      if (!isFieldInitializer(node)) return;
      // Skip plain MobX store classes — the lifecycle asymmetry only exists
      // for React class components.
      if (!getEnclosingEs6Component(node)) return;

      context.report({ node, message: MESSAGE });
    },
  }),
});
