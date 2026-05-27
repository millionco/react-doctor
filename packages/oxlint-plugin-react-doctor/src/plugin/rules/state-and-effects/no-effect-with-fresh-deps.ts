import { HOOKS_WITH_DEPS } from "../../constants/react.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

type FreshDepKind = "object" | "array" | "function" | "JSX" | "instance";

interface FreshDepFinding {
  readonly hookName: string;
  readonly depKind: FreshDepKind;
  readonly node: EsTreeNode;
}

const classifyFreshDependency = (expression: EsTreeNode): FreshDepKind | null => {
  const stripped = stripParenExpression(expression);
  if (isNodeOfType(stripped, "ObjectExpression")) return "object";
  if (isNodeOfType(stripped, "ArrayExpression")) return "array";
  if (
    isNodeOfType(stripped, "ArrowFunctionExpression") ||
    isNodeOfType(stripped, "FunctionExpression")
  ) {
    return "function";
  }
  if (isNodeOfType(stripped, "JSXElement") || isNodeOfType(stripped, "JSXFragment")) {
    return "JSX";
  }
  if (isNodeOfType(stripped, "NewExpression")) return "instance";
  return null;
};

// Hooks whose results are guaranteed to be referentially stable across
// renders, so following an Identifier dep back to one of these is fine.
// Includes the React `use*` hook return types we can prove are
// stable: useRef returns `{current}` (same object), useState returns
// a setter (stable), useMemo / useCallback are explicit memoisation,
// useReducer returns `[state, dispatch]` (dispatch is stable, state
// is treated by exhaustive-deps as the dep), useId is a string. For
// any other hook (`useFoo(...)`) we don't know the return shape —
// treat as opaque (don't flag).
const STABLE_HOOK_INITIALIZERS = new Set([
  "useRef",
  "useState",
  "useReducer",
  "useMemo",
  "useCallback",
  "useEffectEvent",
  "useEvent",
  "useId",
]);

// Returns the "fresh allocation" kind for `dep`, or null if the dep
// is referentially stable enough that flagging would produce a false
// positive. Distinguishes three cases:
//
//   1. The dep is itself a syntactically constructed value
//      (ObjectExpression, ArrayExpression, etc.) — handled by the
//      classifier above and reported with `node: dep`.
//   2. The dep is an Identifier whose binding's initializer is
//      ALSO a constructed value — render-local allocation captured
//      through a name. Reported with `node: dep` so the diagnostic
//      points at the dep array, and the message mentions both the
//      name and the underlying allocation kind.
//   3. The dep is anything else (a member access, a function call,
//      a TS as-expression, a primitive literal, …) — treated as
//      opaque / stable enough; no diagnostic.
interface ResolvedFreshness {
  readonly kind: FreshDepKind;
  // Set when the freshness was discovered through a name binding
  // rather than at the dep site. Drives the diagnostic wording.
  readonly viaBindingName: string | null;
}

const isInsideStableHookCall = (initializer: EsTreeNode): boolean => {
  let cursor: EsTreeNode | null | undefined = initializer.parent;
  while (cursor && cursor.type !== "VariableDeclarator") {
    if (isNodeOfType(cursor, "CallExpression")) {
      const callee = cursor.callee;
      if (isNodeOfType(callee, "Identifier") && STABLE_HOOK_INITIALIZERS.has(callee.name)) {
        return true;
      }
      if (
        isNodeOfType(callee, "MemberExpression") &&
        isNodeOfType(callee.property, "Identifier") &&
        STABLE_HOOK_INITIALIZERS.has(callee.property.name)
      ) {
        return true;
      }
    }
    cursor = cursor.parent ?? null;
  }
  return false;
};

const resolveDependencyFreshness = (dep: EsTreeNode): ResolvedFreshness | null => {
  const directKind = classifyFreshDependency(dep);
  if (directKind) return { kind: directKind, viaBindingName: null };

  const stripped = stripParenExpression(dep);
  if (!isNodeOfType(stripped, "Identifier")) return null;
  const binding = findVariableInitializer(stripped, stripped.name);
  if (!binding || !binding.initializer) return null;
  // Bindings declared at module scope (Program) are allocated once;
  // they're safe to use as deps regardless of shape.
  if (binding.scopeOwner.type === "Program") return null;
  // Followed bindings whose initializer is the return value of an
  // explicit memoising hook are stable by construction.
  if (isInsideStableHookCall(binding.initializer)) return null;
  const indirectKind = classifyFreshDependency(binding.initializer);
  if (!indirectKind) return null;
  return { kind: indirectKind, viaBindingName: stripped.name };
};

// Hooks whose dependency arrays are compared element-wise with `===`
// (Object.is). When an element of the dep array is constructed during
// render — a fresh `{...}` / `[...]` / `() => ...` / JSX / `new Foo()`
// — the comparison always fails and the effect fires on every render.
//
// This is the most common cause of "my useEffect runs forever" bugs.
//
// Detection covers TWO shapes:
//
//   1. Inline allocation at the dep site:
//        useEffect(fn, [{ a, b }, [x], () => z]);
//
//   2. Allocation captured through an in-scope Identifier:
//        const config = { a, b };
//        useEffect(fn, [config]);     // ← also flagged
//
//      The Identifier is resolved via `findVariableInitializer`.
//      Bindings at module scope (allocated once) and bindings whose
//      initializer comes from a known stable hook (useRef / useState /
//      useMemo / useCallback / useReducer / useEffectEvent / useId)
//      are exempt.
//
// Companion to `exhaustive-deps`, which catches missing deps. This
// rule catches dep array elements that exist but break the comparison
// invariant.
//
// LIMITATIONS:
//   - Spread elements (`[...someArray]`) are ignored — too uncommon
//     to handle cleanly here, and `exhaustive-deps` doesn't model
//     them either.
//   - Only one level of indirection: `const a = { x }; const b = a;`
//     followed by `[b]` is not flagged. The common shape in real
//     code is direct, and chained re-assignments are rare.
//   - Custom user hooks (`useMyThing(...)`) returning fresh objects
//     are treated as opaque to avoid flagging genuinely-stable
//     custom-hook results.
export const noEffectWithFreshDeps = defineRule<Rule>({
  id: "no-effect-with-fresh-deps",
  severity: "error",
  category: "State & Effects",
  recommendation:
    "Move the constructed value into the hook body (so it's recomputed during render) and instead depend on its primitive inputs, or wrap the value in useMemo / useCallback so its reference is stable.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isHookCall(node, HOOKS_WITH_DEPS)) return;
      const args = node.arguments ?? [];
      if (args.length < 2) return;

      const depsNode = args[1];
      if (!depsNode) return;
      const stripped = stripParenExpression(depsNode);
      if (!isNodeOfType(stripped, "ArrayExpression")) return;

      const calleeNode = node.callee;
      let hookName: string;
      if (isNodeOfType(calleeNode, "Identifier")) {
        hookName = calleeNode.name;
      } else if (
        isNodeOfType(calleeNode, "MemberExpression") &&
        isNodeOfType(calleeNode.property, "Identifier")
      ) {
        hookName = calleeNode.property.name;
      } else {
        hookName = "hook";
      }

      const elements = stripped.elements ?? [];
      for (const element of elements) {
        if (!element) continue;
        // Spread elements have a `type: "SpreadElement"` shape — we skip
        // them rather than try to model their referents.
        if (isNodeOfType(element, "SpreadElement")) continue;
        const freshness = resolveDependencyFreshness(element);
        if (!freshness) continue;
        const message = freshness.viaBindingName
          ? `${hookName} dep array element \`${freshness.viaBindingName}\` is a render-local ${freshness.kind} (declared in the same component scope); \`===\` will always fail because the binding is re-allocated each render. Hoist it to module scope or wrap it in useMemo/useCallback.`
          : `${hookName} dep array contains a freshly-allocated ${freshness.kind}; \`===\` will always fail on this element so the hook runs every render. Move the value into the hook body or memoize it with useMemo/useCallback so its reference is stable.`;
        context.report({ node: element, message });
      }
    },
  }),
});
