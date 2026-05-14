import { defineRule } from "../../utils/define-rule.js";
import { isComponentAssignment } from "../../utils/is-component-assignment.js";
import { isUppercaseName } from "../../utils/is-uppercase-name.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const HOOK_OBJECTS_WITH_METHODS = new Map<string, Set<string>>([
  ["useRouter", new Set(["push", "replace", "back", "forward", "refresh", "prefetch"])],
  [
    "useNavigation",
    new Set(["navigate", "push", "goBack", "popToTop", "reset", "replace", "dispatch"]),
  ],
  ["useSearchParams", new Set(["get", "getAll", "has", "set"])],
]);

// HACK: O(1) lookup. Indexes top-level `const x = useFooBar(...)`
// declarations once per component on enter, so subsequent
// MemberExpression visitors don't re-walk the whole body for every
// access.
const buildHookBindingMap = (componentBody: EsTreeNode | null | undefined): Map<string, string> => {
  const result = new Map<string, string>();
  if (!componentBody || !isNodeOfType(componentBody, "BlockStatement")) return result;
  for (const statement of componentBody.body ?? []) {
    if (!isNodeOfType(statement, "VariableDeclaration")) continue;
    for (const declarator of statement.declarations ?? []) {
      if (!isNodeOfType(declarator.id, "Identifier")) continue;
      if (!isNodeOfType(declarator.init, "CallExpression")) continue;
      const callee = declarator.init.callee;
      if (!isNodeOfType(callee, "Identifier")) continue;
      result.set(declarator.id.name, callee.name);
    }
  }
  return result;
};

// HACK: React Compiler memoizes inside a component based on stable
// reference equality of *destructured* values. `router.push("/x")`
// reads `push` off the hook return on every render, which the compiler
// can't memoize as cleanly as a destructured `const { push } = useRouter()`.
// The destructured form also makes the dependency graph obvious — if
// you only need `push`, the compiler doesn't need to track all of
// `router`. This is a soft signal even without React Compiler enabled
// (it makes intent clearer and reduces accidental capture).
//
// Heuristic: `router.push(...)` (or any of the canonical hook objects)
// where `router` is bound to a `useRouter()` call in the same component.
// We don't fire when the binding is destructured already.
export const reactCompilerDestructureMethod = defineRule<Rule>({
  framework: "global",
  severity: "warn",
  category: "Architecture",
  recommendation:
    "Destructure the method up front: `const { push } = useRouter()` then call `push(...)` directly — clearer dependency graph and easier for React Compiler to memoize",
  examples: [
    {
      before: "const router = useRouter();\nrouter.push('/home');",
      after: "const { push } = useRouter();\npush('/home');",
    },
  ],
  create: (context: RuleContext) => {
    const hookBindingMapStack: Array<Map<string, string>> = [];

    const isComponent = (node: EsTreeNode): boolean => {
      if (isNodeOfType(node, "FunctionDeclaration")) {
        return Boolean(node.id?.name && isUppercaseName(node.id.name));
      }
      if (isNodeOfType(node, "VariableDeclarator")) {
        return isComponentAssignment(node);
      }
      return false;
    };

    // HACK: push UNCONDITIONALLY for every component so push/pop stay
    // balanced. A concise-arrow component (`const Foo = () => <div />`)
    // has no BlockStatement body and therefore no hook bindings, but it
    // still triggers the matching `:exit` — without an unconditional
    // push, the exit would pop the *outer* component's frame and silently
    // drop diagnostics on every member access in the parent. The empty
    // Map returned by `buildHookBindingMap` for non-Block bodies is the
    // correct semantic for "this component declares zero hook bindings".
    const enter = (node: EsTreeNode): void => {
      if (!isComponent(node)) return;
      let body: EsTreeNode | null | undefined;
      if (isNodeOfType(node, "FunctionDeclaration")) {
        body = node.body;
      } else if (isNodeOfType(node, "VariableDeclarator")) {
        const initializer = node.init;
        body =
          isNodeOfType(initializer, "ArrowFunctionExpression") ||
          isNodeOfType(initializer, "FunctionExpression")
            ? initializer.body
            : null;
      }
      hookBindingMapStack.push(buildHookBindingMap(body));
    };
    const exit = (node: EsTreeNode): void => {
      if (isComponent(node)) hookBindingMapStack.pop();
    };

    return {
      FunctionDeclaration: enter,
      "FunctionDeclaration:exit": exit,
      VariableDeclarator: enter,
      "VariableDeclarator:exit": exit,
      MemberExpression(node: EsTreeNodeOfType<"MemberExpression">) {
        if (hookBindingMapStack.length === 0) return;
        if (node.computed) return;
        if (!isNodeOfType(node.object, "Identifier")) return;
        if (!isNodeOfType(node.property, "Identifier")) return;

        const bindingName = node.object.name;
        const methodName = node.property.name;
        const hookBindings = hookBindingMapStack[hookBindingMapStack.length - 1];
        const hookSource = hookBindings.get(bindingName);
        if (!hookSource) return;

        const allowedMethods = HOOK_OBJECTS_WITH_METHODS.get(hookSource);
        if (!allowedMethods || !allowedMethods.has(methodName)) return;

        if (!isNodeOfType(node.parent, "CallExpression") || node.parent.callee !== node) return;

        context.report({
          node,
          message: `Destructure for clarity: \`const { ${methodName} } = ${hookSource}()\` then call \`${methodName}(...)\` directly — easier for React Compiler to memoize and clearer about which methods this component depends on`,
        });
      },
    };
  },
});
