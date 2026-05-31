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
  // Only an UNCONDITIONAL direct `const/let/var name = <literal>` is a
  // render-local allocation the component owns. A parameter or
  // destructuring DEFAULT (`function List({ items = [] })`,
  // `const { config = {} } = props`) records its default as the
  // initializer, but that value only allocates when the source is
  // undefined — so flagging it (with a "hoist to module scope" fix
  // that can't apply to a prop) is a false positive. Require the
  // binding to be a direct VariableDeclarator initializer.
  const declarator = binding.bindingIdentifier.parent;
  if (
    !declarator ||
    !isNodeOfType(declarator, "VariableDeclarator") ||
    declarator.init !== binding.initializer
  ) {
    return null;
  }
  // Initializers that are themselves a CallExpression (any function
  // call — including `useMemo(...)`, `useCallback(...)`, `useRef(...)`,
  // and ANY user-defined hook) are treated as opaque: their return
  // value's referential stability depends on the called function's
  // implementation, which we can't see. `classifyFreshDependency`
  // returns null for CallExpression nodes, so the call below naturally
  // bails out without us needing an explicit hook allowlist.
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
  title: "Effect dependency recreated every render",
  severity: "error",
  category: "State & Effects",
  recommendation:
    "Move the value inside the hook body and depend on its simple inputs instead, or wrap it in useMemo / useCallback so it stays the same between renders.",
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
          ? `Your ${hookName} runs every render because dep \`${freshness.viaBindingName}\` is a new ${freshness.kind} built fresh each time, so \`===\` always fails.`
          : `Your ${hookName} runs every render because its deps include a new ${freshness.kind} built fresh each time, so \`===\` always fails.`;
        context.report({ node: element, message });
      }
    },
  }),
});
