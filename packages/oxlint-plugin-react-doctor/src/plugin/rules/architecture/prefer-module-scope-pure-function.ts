import { defineRule } from "../../utils/define-rule.js";
import { enclosingComponentOrHookScope } from "../../utils/enclosing-component-or-hook-scope.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { closureCaptures } from "../../semantic/closure-captures.js";
import { isDescendantScope, type ScopeDescriptor } from "../../semantic/scope-analysis.js";

// `prop-types`, `defaultProps`, etc. — `Component.foo = (...) => {}` is
// a class-static-ish pattern that's usually intentional and isn't a
// candidate for hoisting (it depends on the component identity).
const isAssignedToComponentMember = (functionNode: EsTreeNode): boolean => {
  const parent = functionNode.parent;
  if (!parent) return false;
  return (
    isNodeOfType(parent, "AssignmentExpression") && isNodeOfType(parent.left, "MemberExpression")
  );
};

// Closure captures that resolve to a binding ANYWHERE inside the
// component's body (props destructure, useState locals, hook return
// values, plain consts). Bindings outside the component scope (module
// imports, module-level consts, hoisted React APIs) are ignored — they
// remain reachable when the function is hoisted to module scope.
const hasComponentLocalCaptures = (
  functionNode: EsTreeNode,
  bodyScope: ScopeDescriptor,
  scopes: RuleContext["scopes"],
): boolean => {
  const captures = closureCaptures(functionNode, scopes);
  for (const capture of captures) {
    const symbol = capture.resolvedSymbol;
    if (!symbol) continue;
    if (isDescendantScope(symbol.scope, bodyScope)) return true;
  }
  return false;
};

// Detects function expressions / arrow functions defined inside a
// component or hook whose body closes over NO component-local state
// — i.e. the function only uses its own parameters plus module-scope
// bindings. Such functions belong outside the component:
//
//   - They allocate a new identity per render (perf cost, breaks
//     memoised consumer comparisons).
//   - They look like they're stateful to a profiler / debugger.
//   - They can't be unit-tested in isolation without rendering the
//     parent component.
//
// Quotes from the source material:
//
//   "Declare functions that need not be in the React component outside
//    the component. This way they're not reallocated on every render."
//     — coryhouse/reactjsconsulting#77
//
//   "Prefer pure functions (which can be extracted from the component)
//    over useCallback when possible."
//     — coryhouse/reactjsconsulting#77
//
// Scope (v1):
//   - Only flags `const foo = () => {...}` / `const foo = function() {...}`
//     / `function foo() {}` named bindings inside the component body.
//     Anonymous inline functions (JSX `onClick={() => ...}`) are out
//     of scope — those are covered by `jsx-no-new-function-as-prop`.
//   - Skips when the function is the first argument to a memoising
//     caller (useCallback / useMemo / memo / forwardRef / lazy /
//     observer) because the user has already explicitly opted into
//     memoisation at the call site.
//   - Skips assignments to MemberExpressions (`Component.helper = (
//     ) => ...`) — those are intentional component-attached helpers.
//   - Uses the existing scope-analysis pipeline (`closureCaptures`)
//     to detect any binding from inside the component's body scope.
export const preferModuleScopePureFunction = defineRule<Rule>({
  id: "prefer-module-scope-pure-function",
  title: "Pure function rebuilt every render",
  tags: ["test-noise"],
  severity: "warn",
  category: "Architecture",
  recommendation:
    "Move the function above the component, at the top of the file. It doesn't use local state, so rebuilding it each update is wasted work.",
  create: (context: RuleContext) => {
    const report = (functionNode: EsTreeNode, name: string, componentName: string): void => {
      context.report({
        node: functionNode,
        message: `\`${name}\` inside \`${componentName}\` uses no local state but is rebuilt on every render, so it wastes work & breaks memoized children. Move it to the top of the file, outside the component.`,
      });
    };

    // The useCallback/useMemo wrapper case (`const f = useCallback(...)`)
    // is already filtered out in the VariableDeclarator visitor by
    // the `init must be ArrowFunctionExpression / FunctionExpression`
    // guard — when the init is a CallExpression we never reach this
    // helper. No further memo-call check needed here.
    const checkNamedFunction = (functionNode: EsTreeNode, bindingName: string): void => {
      if (isAssignedToComponentMember(functionNode)) return;
      const component = enclosingComponentOrHookScope(functionNode, context.scopes.ownScopeFor);
      if (!component) return;
      const ownScope = context.scopes.ownScopeFor(functionNode);
      if (!ownScope) return;
      // The function's body scope must be a STRICT descendant of the
      // component body — otherwise we found the component itself.
      if (ownScope === component.bodyScope) return;
      if (!isDescendantScope(ownScope, component.bodyScope)) return;
      if (hasComponentLocalCaptures(functionNode, component.bodyScope, context.scopes)) return;
      report(functionNode, bindingName, component.displayName);
    };

    return {
      VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
        if (!isNodeOfType(node.id, "Identifier")) return;
        const initializer = node.init;
        if (!initializer) return;
        if (
          !isNodeOfType(initializer, "ArrowFunctionExpression") &&
          !isNodeOfType(initializer, "FunctionExpression")
        ) {
          return;
        }
        // PascalCase bindings inside a component look like nested
        // component definitions. `no-nested-component-definition`
        // already handles those.
        const bindingName = node.id.name;
        if (/^[A-Z]/.test(bindingName)) return;
        checkNamedFunction(initializer, bindingName);
      },
      FunctionDeclaration(node: EsTreeNodeOfType<"FunctionDeclaration">) {
        if (!node.id?.name) return;
        const bindingName = node.id.name;
        if (/^[A-Z]/.test(bindingName)) return;
        // Hooks are by definition closures over local state in their
        // call site — but a named hook inside ANOTHER hook with no
        // captures is genuinely hoistable. Allow the regular flow.
        checkNamedFunction(node, bindingName);
      },
    };
  },
});
