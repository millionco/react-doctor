import { defineRule } from "../../utils/define-rule.js";
import { isEs6Component } from "../../utils/is-es6-component.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";

const MESSAGE =
  "This observable field initializer reads `this.props`/`this.state`, which runs before the constructor reaches `makeObservable`, so it captures a non-reactive early value; declare the field type-only and assign it in the constructor after `makeObservable(this)`.";

const OBSERVABLE_SETUP_CALLEES = new Set(["makeObservable", "makeAutoObservable", "decorate"]);
const ANNOTATION_ARGUMENT_CALLEES = new Set(["makeObservable", "makeAutoObservable"]);
const OBSERVABLE_DECORATOR_NAMES = new Set(["observable", "computed"]);

// True when the expression eagerly reads `this.props` / `this.state`. Nested
// functions are pruned: `= () => this.props.x` reads them lazily (after
// `makeObservable`), so it is not the field-initializer-ordering bug.
const eagerlyReadsThisPropsOrState = (initializer: EsTreeNode): boolean => {
  let readsThis = false;
  walkAst(initializer, (child: EsTreeNode) => {
    if (readsThis) return false;
    // A function-valued initializer reads `this` lazily (when called, after
    // `makeObservable`), so it is never the eager-ordering bug.
    if (isFunctionLike(child)) return false;
    if (
      isNodeOfType(child, "MemberExpression") &&
      isNodeOfType(child.object, "ThisExpression") &&
      isNodeOfType(child.property, "Identifier") &&
      (child.property.name === "props" || child.property.name === "state")
    ) {
      readsThis = true;
      return false;
    }
  });
  return readsThis;
};

const getDecoratorRootName = (
  decoratorExpression: EsTreeNode | null | undefined,
): string | null => {
  let current: EsTreeNode | null | undefined = decoratorExpression;
  while (current) {
    if (isNodeOfType(current, "Identifier")) return current.name;
    if (isNodeOfType(current, "MemberExpression")) {
      current = current.object;
      continue;
    }
    if (isNodeOfType(current, "CallExpression")) {
      current = current.callee;
      continue;
    }
    return null;
  }
  return null;
};

const isDecoratedObservable = (member: EsTreeNodeOfType<"PropertyDefinition">): boolean =>
  (member.decorators ?? []).some((decorator) =>
    OBSERVABLE_DECORATOR_NAMES.has(getDecoratorRootName(decorator.expression) ?? ""),
  );

const getPropertyKeyName = (key: EsTreeNode): string | null => {
  if (isNodeOfType(key, "Identifier")) return key.name;
  if (isNodeOfType(key, "Literal") && typeof key.value === "string") return key.value;
  return null;
};

interface ObservableSetup {
  hasSetupCall: boolean;
  annotationKeys: Set<string>;
}

const collectObservableSetup = (classNode: EsTreeNode): ObservableSetup => {
  let hasSetupCall = false;
  const annotationKeys = new Set<string>();
  walkAst(classNode, (child: EsTreeNode) => {
    if (!isNodeOfType(child, "CallExpression")) return;
    if (!isNodeOfType(child.callee, "Identifier")) return;
    const calleeName = child.callee.name;
    if (!OBSERVABLE_SETUP_CALLEES.has(calleeName)) return;
    hasSetupCall = true;
    if (!ANNOTATION_ARGUMENT_CALLEES.has(calleeName)) return;
    const annotationArgument = child.arguments?.[1];
    if (!isNodeOfType(annotationArgument, "ObjectExpression")) return;
    for (const property of annotationArgument.properties ?? []) {
      if (!isNodeOfType(property, "Property")) continue;
      const keyName = getPropertyKeyName(property.key);
      if (keyName) annotationKeys.add(keyName);
    }
  });
  return { hasSetupCall, annotationKeys };
};

export const mobxPropertyInitializerReadsThisBeforeMakeobservable = defineRule({
  id: "mobx-property-initializer-reads-this-before-makeobservable",
  title: "Field initializer reads this before makeObservable",
  severity: "warn",
  category: "Bugs",
  requires: ["react", "mobx"],
  recommendation:
    "Declare observable fields with a type-only annotation and assign values reading `this.props`/`this.state` in the constructor after `makeObservable(this)`.",
  create: (context: RuleContext) => ({
    ClassBody(node: EsTreeNodeOfType<"ClassBody">) {
      const classNode = node.parent;
      if (!classNode || !isEs6Component(classNode)) return;

      const { hasSetupCall, annotationKeys } = collectObservableSetup(classNode);
      if (!hasSetupCall) return;

      for (const member of node.body ?? []) {
        if (!isNodeOfType(member, "PropertyDefinition")) continue;
        if (!member.value) continue;
        if (!eagerlyReadsThisPropsOrState(member.value)) continue;

        const keyName = getPropertyKeyName(member.key);
        const isObservableField =
          isDecoratedObservable(member) || (keyName !== null && annotationKeys.has(keyName));
        if (!isObservableField) continue;

        context.report({ node: member, message: MESSAGE });
      }
    },
  }),
});
