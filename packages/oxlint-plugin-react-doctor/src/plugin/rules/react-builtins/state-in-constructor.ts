import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isEs6Component } from "../../utils/is-es6-component.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";

const ALWAYS_MESSAGE =
  "This class uses a state field instead of the configured constructor pattern, so state setup is inconsistent across the codebase.";
const NEVER_MESSAGE =
  "This class sets state in the constructor instead of the configured class-field pattern, so state setup is inconsistent across the codebase.";

interface StateInConstructorSettings {
  mode?: "always" | "never";
}

const resolveSettings = (
  settings: Readonly<Record<string, unknown>> | undefined,
): Required<StateInConstructorSettings> => {
  const reactDoctor = settings?.["react-doctor"];
  const ruleSettings =
    typeof reactDoctor === "object" && reactDoctor !== null
      ? ((reactDoctor as { stateInConstructor?: StateInConstructorSettings }).stateInConstructor ??
        {})
      : {};
  return { mode: ruleSettings.mode ?? "always" };
};

const isStateKey = (key: EsTreeNode): boolean => {
  if (isNodeOfType(key, "Identifier")) return key.name === "state";
  if (isNodeOfType(key, "Literal") && typeof key.value === "string") return key.value === "state";
  return false;
};

const findEnclosingClass = (
  node: EsTreeNode,
): EsTreeNodeOfType<"ClassDeclaration" | "ClassExpression"> | null => {
  let ancestor: EsTreeNode | null | undefined = node.parent;
  while (ancestor) {
    if (isNodeOfType(ancestor, "ClassDeclaration") || isNodeOfType(ancestor, "ClassExpression")) {
      return ancestor;
    }
    ancestor = ancestor.parent ?? null;
  }
  return null;
};

const isInConstructor = (node: EsTreeNode): boolean => {
  let ancestor: EsTreeNode | null | undefined = node.parent;
  while (ancestor) {
    if (
      isNodeOfType(ancestor, "MethodDefinition") &&
      "kind" in ancestor &&
      ancestor.kind === "constructor"
    ) {
      return true;
    }
    if (isNodeOfType(ancestor, "ClassDeclaration") || isNodeOfType(ancestor, "ClassExpression")) {
      return false;
    }
    ancestor = ancestor.parent ?? null;
  }
  return false;
};

// Port of `oxc_linter::rules::react::state_in_constructor`. Two modes:
//   - "always" (default): flags `state = {…}` class fields on a React
//     class component (state should be set in `constructor`).
//   - "never": flags `this.state = {…}` inside a constructor of a
//     React class component (state should be a class field instead).
export const stateInConstructor = defineRule<Rule>({
  id: "state-in-constructor",
  title: "State initialized in constructor",
  severity: "warn",
  // Pure stylistic — class field initializers (`state = {...}`) and
  // explicit constructor assignment are equivalent at runtime. The
  // class-field form is idiomatic modern TypeScript. Default off.
  defaultEnabled: false,
  recommendation: "Use one class-state setup pattern so readers know where initial state lives.",
  category: "Architecture",
  create: (context) => {
    const { mode } = resolveSettings(context.settings);

    return {
      PropertyDefinition(node: EsTreeNodeOfType<"PropertyDefinition">) {
        if (mode !== "always") return;
        if (node.static) return;
        if (!isStateKey(node.key)) return;
        const enclosingClass = findEnclosingClass(node);
        if (!enclosingClass || !isEs6Component(enclosingClass)) return;
        context.report({ node: node.key, message: ALWAYS_MESSAGE });
      },
      AssignmentExpression(node: EsTreeNodeOfType<"AssignmentExpression">) {
        if (mode !== "never") return;
        const target = node.left;
        if (!isNodeOfType(target, "MemberExpression")) return;
        if (!isNodeOfType(target.object, "ThisExpression")) return;
        if (!isStateKey(target.property)) return;
        const enclosingClass = findEnclosingClass(node);
        if (!enclosingClass || !isEs6Component(enclosingClass)) return;
        if (!isInConstructor(node)) return;
        context.report({ node: target, message: NEVER_MESSAGE });
      },
    };
  },
});
