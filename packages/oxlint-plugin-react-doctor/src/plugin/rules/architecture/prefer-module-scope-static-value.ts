import { MUTATING_ARRAY_METHODS, MUTATING_COLLECTION_METHODS } from "../../constants/js.js";
import { defineRule } from "../../utils/define-rule.js";
import { enclosingComponentOrHookScope } from "../../utils/enclosing-component-or-hook-scope.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import {
  isDescendantScope,
  type ScopeAnalysis,
  type ScopeDescriptor,
} from "../../semantic/scope-analysis.js";

// Receiver-mutating method names. Calling any of these on the binding
// (`OPTS.push(...)`, `byId.set(...)`) mutates the underlying value;
// hoisting the binding to module scope would silently break code that
// relies on per-render reinitialisation OR — for module-level mutation —
// turn the const into a shared global mutable singleton.
//
// Read-only methods (`.includes`, `.indexOf`, `.find`, `.filter`,
// `.map`, `.some`, `.every`, `.reduce`, `.slice`, `.concat`, `.join`,
// the ES2023 `.toSorted` / `.toReversed` / `.toSpliced` / `.with`,
// etc.) are intentionally NOT in this list because they return a new
// value without mutating the receiver — hoisting is safe for them.
const MUTATING_RECEIVER_METHOD_NAMES = new Set([
  ...MUTATING_ARRAY_METHODS,
  ...MUTATING_COLLECTION_METHODS,
]);

// True when an identifier `reference` to the const binding sits in a
// position that mutates the bound value. Covers four shapes:
//
//   1. LHS of assignment: `OPTS = ...` / `OPTS.foo = ...` / `OPTS[0] = ...`
//   2. `delete OPTS.foo` / `delete OPTS[0]`
//   3. UpdateExpression `OPTS.count++` — only when the OPTS reference
//      is the receiver of the MemberExpression, not the entire target
//      (so `++localCounter` on a primitive binding is also caught for
//      completeness).
//   4. Mutating method call: `OPTS.push(...)` / `byId.set(...)`.
const isMutationContext = (referenceIdentifier: EsTreeNode): boolean => {
  const parent = referenceIdentifier.parent;
  if (!parent) return false;

  // Direct rebinding: `OPTS = somethingElse`.
  if (isNodeOfType(parent, "AssignmentExpression") && parent.left === referenceIdentifier) {
    return true;
  }

  // `++OPTS` / `OPTS--` — primitive mutation; rare for array/object
  // bindings but treated as a mutation for completeness.
  if (isNodeOfType(parent, "UpdateExpression") && parent.argument === referenceIdentifier) {
    return true;
  }

  // Member-expression contexts: `OPTS.foo` / `OPTS[0]`.
  if (isNodeOfType(parent, "MemberExpression") && parent.object === referenceIdentifier) {
    const grandparent = parent.parent;
    if (!grandparent) return false;

    // `OPTS.foo = bar` / `OPTS[0] = x` / compound assignments.
    if (isNodeOfType(grandparent, "AssignmentExpression") && grandparent.left === parent) {
      return true;
    }

    // `OPTS.count++` / `++OPTS.foo`.
    if (isNodeOfType(grandparent, "UpdateExpression") && grandparent.argument === parent) {
      return true;
    }

    // `delete OPTS.foo` / `delete OPTS[0]`.
    if (
      isNodeOfType(grandparent, "UnaryExpression") &&
      grandparent.operator === "delete" &&
      grandparent.argument === parent
    ) {
      return true;
    }

    // `OPTS.push(...)` — mutating method call. The MemberExpression
    // must itself be the callee of a CallExpression and the property
    // must be a non-computed Identifier in our mutating-names set.
    if (
      isNodeOfType(grandparent, "CallExpression") &&
      grandparent.callee === parent &&
      !parent.computed &&
      isNodeOfType(parent.property, "Identifier") &&
      MUTATING_RECEIVER_METHOD_NAMES.has(parent.property.name)
    ) {
      return true;
    }
  }

  return false;
};

// Returns true when ANY reference to the binding (excluding the
// declarator itself) sits in a mutating position somewhere inside
// `bodyScope`. Bindings that are read-only after init are safe to
// hoist; mutated bindings are not.
const isBindingMutatedAfterInit = (
  declaratorNode: EsTreeNodeOfType<"VariableDeclarator">,
  bodyScope: ScopeDescriptor,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isNodeOfType(declaratorNode.id, "Identifier")) return false;
  const symbol = scopes.symbolFor(declaratorNode.id);
  if (!symbol) return false;
  for (const reference of symbol.references) {
    if (reference.identifier === declaratorNode.id) continue;
    if (reference.identifier === declaratorNode.init) continue;
    // Only consider references that live INSIDE the component body —
    // a reference in an unrelated scope can't apply here, and the
    // binding's scope is itself a descendant of bodyScope.
    if (!isDescendantScope(reference.scope, bodyScope) && reference.scope !== bodyScope) {
      continue;
    }
    if (isMutationContext(reference.identifier)) return true;
  }
  return false;
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

  walkAst(expression, (node) => {
    if (foundLocal) return false;
    // Don't recurse into inner functions: they don't run during the
    // value's allocation, they only define their own scope. (We're
    // looking at top-level "what does this allocation refer to".)
    // Note: inner functions ARE captures themselves, but we already
    // handle "all-literal" via the recursive shape — and a function
    // expression nested inside the value is itself a closure that
    // breaks the "hoistable" property regardless.
    if (isNodeOfType(node, "ArrowFunctionExpression") || isNodeOfType(node, "FunctionExpression")) {
      foundLocal = true;
      return false;
    }
    const reference = scopes.referenceFor(node);
    if (reference?.resolvedSymbol && isDescendantScope(reference.resolvedSymbol.scope, bodyScope)) {
      foundLocal = true;
      return false;
    }
    return undefined;
  });

  return foundLocal;
};

const isHoistableValueExpression = (expression: EsTreeNode): boolean => {
  const stripped = stripParenExpression(expression);
  return isNodeOfType(stripped, "ArrayExpression") || isNodeOfType(stripped, "ObjectExpression");
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
//     a nested function. `enclosingComponentOrHookScope` stops at the
//     first function boundary, so a value declared in a `useMemo` /
//     `useCallback` callback or an event handler is naturally skipped
//     (the nearest enclosing function isn't the component/hook).
//   - Uses scope analysis to verify the initializer has no references
//     to bindings inside the component's body scope. Module-scope
//     imports and globals are fine to capture from module scope too.
//   - Also treats inner function expressions as "uses local state" —
//     a function inside the value is itself a closure, and hoisting
//     would change its semantics.
export const preferModuleScopeStaticValue = defineRule<Rule>({
  id: "prefer-module-scope-static-value",
  title: "Static value rebuilt every render",
  tags: ["test-noise"],
  severity: "warn",
  category: "Architecture",
  // React Compiler hoists/caches these per-render allocations itself, so
  // both halves of the recommendation (avoid the re-allocation, preserve
  // referential equality for memoized children) are already handled — the
  // warning is pure noise on a compiler-enabled codebase. Mirrors the
  // `jsx-no-new-*-as-prop` rules, which gate on the same capability for
  // the same referential-equality reason.
  disabledBy: ["react-compiler"],
  recommendation:
    "Move the value above the component, at the top of the file. It doesn't use local state, so rebuilding it each update is wasted and makes it look new every time.",
  create: (context: RuleContext) => ({
    VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
      if (!isNodeOfType(node.id, "Identifier")) return;
      const initializer = node.init;
      if (!initializer) return;
      if (!isHoistableValueExpression(initializer)) return;
      const component = enclosingComponentOrHookScope(node, context.scopes.ownScopeFor);
      if (!component) return;
      if (hasComponentLocalReferences(initializer, component.bodyScope, context.scopes)) {
        return;
      }
      // Hoisting a mutated binding to module scope would either
      // silently lose the per-render reinitialisation OR turn the
      // const into a shared mutable singleton. Either way the rule's
      // recommendation would break code that mutates after init.
      // Read-only methods (.includes/.find/.map/.filter/etc.) DON'T
      // count as mutations and are unaffected by this guard.
      if (isBindingMutatedAfterInit(node, component.bodyScope, context.scopes)) return;
      const bindingName = node.id.name;
      context.report({
        node,
        message: `\`${bindingName}\` inside \`${component.displayName}\` uses no local state but is rebuilt every render, so it looks new each time & breaks memoized children. Move it to the top of the file, outside the component.`,
      });
    },
  }),
});
