import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isAstNode } from "../../utils/is-ast-node.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactComponentOrHookName } from "../../utils/is-react-component-or-hook-name.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import {
  isDescendantScope,
  type ScopeAnalysis,
  type ScopeDescriptor,
} from "../../semantic/scope-analysis.js";

interface EnclosingComponent {
  readonly bodyScope: ScopeDescriptor;
  readonly displayName: string;
}

const findEnclosingComponentOrHook = (
  startNode: EsTreeNode,
  ownScopeFor: ScopeAnalysis["ownScopeFor"],
): EnclosingComponent | null => {
  let cursor: EsTreeNode | null | undefined = startNode.parent;
  while (cursor) {
    if (isNodeOfType(cursor, "FunctionDeclaration")) {
      const name = cursor.id?.name ?? null;
      if (name && isReactComponentOrHookName(name)) {
        const bodyScope = ownScopeFor(cursor);
        if (bodyScope) return { bodyScope, displayName: name };
      }
    }
    if (isNodeOfType(cursor, "VariableDeclarator")) {
      const initializer = cursor.init;
      const isFunctionInitializer =
        initializer &&
        (isNodeOfType(initializer, "ArrowFunctionExpression") ||
          isNodeOfType(initializer, "FunctionExpression"));
      if (isFunctionInitializer && isNodeOfType(cursor.id, "Identifier")) {
        const identifierName = cursor.id.name;
        if (isReactComponentOrHookName(identifierName)) {
          const bodyScope = ownScopeFor(initializer);
          if (bodyScope) return { bodyScope, displayName: identifierName };
        }
      }
    }
    cursor = cursor.parent ?? null;
  }
  return null;
};

// Walks the expression and collects every referenced identifier whose
// binding lives INSIDE the component scope. Used to decide whether the
// value is hoistable.
const hasComponentLocalReferences = (
  expression: EsTreeNode,
  bodyScope: ScopeDescriptor,
  scopes: ScopeAnalysis,
): boolean => {
  let foundLocal = false;

  const visit = (node: EsTreeNode): void => {
    if (foundLocal) return;
    // Don't recurse into inner functions: they don't run during the
    // value's allocation, they only define their own scope. (We're
    // looking at top-level "what does this allocation refer to".)
    // Note: inner functions ARE captures themselves, but we already
    // handle "all-literal" via the recursive shape — and a function
    // expression nested inside the value is itself a closure that
    // breaks the "hoistable" property regardless.
    if (isNodeOfType(node, "ArrowFunctionExpression") || isNodeOfType(node, "FunctionExpression")) {
      foundLocal = true;
      return;
    }
    const reference = scopes.referenceFor(node);
    if (reference?.resolvedSymbol) {
      if (isDescendantScope(reference.resolvedSymbol.scope, bodyScope)) {
        foundLocal = true;
        return;
      }
    }

    const record = node as unknown as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (key === "parent") continue;
      const child = record[key];
      if (Array.isArray(child)) {
        for (const item of child) if (isAstNode(item)) visit(item);
      } else if (isAstNode(child)) {
        visit(child);
      }
    }
  };

  visit(expression);
  return foundLocal;
};

const isHoistableValueExpression = (expression: EsTreeNode): boolean => {
  const stripped = stripParenExpression(expression);
  return isNodeOfType(stripped, "ArrayExpression") || isNodeOfType(stripped, "ObjectExpression");
};

const KNOWN_MEMOISING_CALLERS = new Set([
  "useCallback",
  "useMemo",
  "memo",
  "forwardRef",
  "observer",
  "lazy",
]);

const isInsideMemoisingCall = (node: EsTreeNode): boolean => {
  let cursor: EsTreeNode | null | undefined = node.parent;
  while (cursor) {
    if (isNodeOfType(cursor, "CallExpression")) {
      const callee = cursor.callee;
      if (isNodeOfType(callee, "Identifier") && KNOWN_MEMOISING_CALLERS.has(callee.name)) {
        return true;
      }
      if (
        isNodeOfType(callee, "MemberExpression") &&
        isNodeOfType(callee.property, "Identifier") &&
        KNOWN_MEMOISING_CALLERS.has(callee.property.name)
      ) {
        return true;
      }
    }
    if (
      isNodeOfType(cursor, "FunctionDeclaration") ||
      isNodeOfType(cursor, "FunctionExpression") ||
      isNodeOfType(cursor, "ArrowFunctionExpression")
    ) {
      return false;
    }
    cursor = cursor.parent ?? null;
  }
  return false;
};

// Detects array / object literals defined inside a component or hook
// whose contents reference NO local state. Such allocations are
// per-render waste and (more importantly) break referential equality
// for any memoised consumer that receives them.
//
// Source material:
//
//   "Declare static values outside the component so they're not
//    reallocated on every render."
//     — coryhouse/reactjsconsulting#77
//
// Scope (v1):
//   - Only flags `ArrayExpression` / `ObjectExpression` initializers
//     on a `const`/`let`/`var` binding. Bare `const X = "literal"`
//     primitives are intentionally NOT flagged — the per-render
//     "allocation" is free for primitives.
//   - The binding must live inside the component's body, not inside
//     a nested function (where the same analysis would apply but is
//     covered by other rules).
//   - Skips bindings inside a memoising call (`useMemo`, `useCallback`,
//     `memo`, `forwardRef`, `observer`, `lazy`) — the user already
//     opted into memoisation there.
//   - Uses scope analysis to verify the initializer has no references
//     to bindings inside the component's body scope. Module-scope
//     imports and globals are fine to capture from module scope too.
//   - Also treats inner function expressions as "uses local state" —
//     a function inside the value is itself a closure, and hoisting
//     would change its semantics.
export const preferModuleScopeStaticValue = defineRule<Rule>({
  id: "prefer-module-scope-static-value",
  tags: ["test-noise"],
  severity: "warn",
  category: "Architecture",
  recommendation:
    "Move the constant to module scope (above the component). It doesn't reference any local state, so the per-render allocation is wasted and any memoised consumer sees a fresh reference each render.",
  create: (context: RuleContext) => ({
    VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
      if (!isNodeOfType(node.id, "Identifier")) return;
      const initializer = node.init;
      if (!initializer) return;
      if (!isHoistableValueExpression(initializer)) return;
      if (isInsideMemoisingCall(node)) return;
      const component = findEnclosingComponentOrHook(node, context.scopes.ownScopeFor);
      if (!component) return;
      if (hasComponentLocalReferences(initializer, component.bodyScope, context.scopes)) {
        return;
      }
      const bindingName = node.id.name;
      context.report({
        node,
        message: `\`${bindingName}\` inside \`${component.displayName}\` doesn't depend on any local state. Move it to module scope so the allocation happens once and memoised consumers see a stable reference.`,
      });
    },
  }),
});
