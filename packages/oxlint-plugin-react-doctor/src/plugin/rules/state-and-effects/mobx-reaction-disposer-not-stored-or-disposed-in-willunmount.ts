import { defineRule } from "../../utils/define-rule.js";
import {
  getImportedNameFromModule,
  isNamespaceImportFromModule,
} from "../../utils/find-import-source-for-name.js";
import { isEs6Component } from "../../utils/is-es6-component.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";

const MESSAGE =
  "This `reaction`/`autorun`/`when` is a class-field initializer, so it runs before the component mounts; move it into `componentDidMount` and wrap it in `disposeOnUnmount(this, ...)` so mount/unmount ordering stays correct.";

const REACTIVE_SUBSCRIPTIONS = new Set(["reaction", "autorun", "when"]);
const DISPOSE_ON_UNMOUNT = "disposeOnUnmount";

// Only the class that owns the field matters — a plain MobX store class
// declared inside a component method must keep the rule's "skip plain MobX
// store classes" exemption, so we never walk past the nearest class ancestor.
const getNearestEnclosingClass = (node: EsTreeNode): EsTreeNode | null => {
  let cursor: EsTreeNode | null | undefined = node.parent;
  while (cursor) {
    if (isNodeOfType(cursor, "ClassDeclaration") || isNodeOfType(cursor, "ClassExpression")) {
      return cursor;
    }
    cursor = cursor.parent ?? null;
  }
  return null;
};

const hasDisposeOnUnmountDecorator = (field: EsTreeNodeOfType<"PropertyDefinition">): boolean => {
  const decorators: ReadonlyArray<EsTreeNode> = Array.isArray(field.decorators)
    ? field.decorators
    : [];
  return decorators.some((decorator) => {
    if (!("expression" in decorator)) return false;
    const decoratorExpression = decorator.expression;
    return (
      isNodeOfType(decoratorExpression, "Identifier") &&
      decoratorExpression.name === DISPOSE_ON_UNMOUNT
    );
  });
};

// A field-initializer disposer is `private x = reaction(...)` — the call's
// direct parent is the PropertyDefinition. `disposeOnUnmount(this, reaction())`
// and `this.x = reaction()` (assignment in a method) have other parents and
// are handled elsewhere / are already correct. The mobx-react decorator form
// `@disposeOnUnmount x = reaction(...)` is the documented equivalent of the
// call form, so it is exempt too.
const getUndisposedFieldInitializer = (
  node: EsTreeNode,
): EsTreeNodeOfType<"PropertyDefinition"> | null => {
  if (!isNodeOfType(node.parent, "PropertyDefinition") || node.parent.value !== node) return null;
  if (hasDisposeOnUnmountDecorator(node.parent)) return null;
  return node.parent;
};

const getMobxSubscriptionName = (node: EsTreeNodeOfType<"CallExpression">): string | null => {
  if (isNodeOfType(node.callee, "Identifier")) {
    const importedName = getImportedNameFromModule(node, node.callee.name, "mobx");
    return importedName && REACTIVE_SUBSCRIPTIONS.has(importedName) ? importedName : null;
  }
  if (
    isNodeOfType(node.callee, "MemberExpression") &&
    !node.callee.computed &&
    isNodeOfType(node.callee.object, "Identifier") &&
    isNodeOfType(node.callee.property, "Identifier") &&
    REACTIVE_SUBSCRIPTIONS.has(node.callee.property.name) &&
    isNamespaceImportFromModule(node, node.callee.object.name, "mobx")
  ) {
    return node.callee.property.name;
  }
  return null;
};

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
      if (!getMobxSubscriptionName(node)) return;

      if (!getUndisposedFieldInitializer(node)) return;
      // Skip plain MobX store classes — the lifecycle asymmetry only exists
      // for React class components.
      const owningClass = getNearestEnclosingClass(node);
      if (!owningClass || !isEs6Component(owningClass)) return;

      context.report({ node, message: MESSAGE });
    },
  }),
});
