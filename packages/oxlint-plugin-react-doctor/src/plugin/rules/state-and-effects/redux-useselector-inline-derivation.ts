import { collectReactReduxSelectorAliases } from "../../utils/collect-react-redux-selector-aliases.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { inlineUseSelectorFunction } from "./utils/inline-use-selector-function.js";

// Array methods that allocate a fresh array on every call. Each one is a
// classic "inline derivation" footgun inside useSelector because the
// resulting reference fails the default `===` check.
//
// NOTE: `reduce` and `reduceRight` are deliberately NOT included.
// They can return any type — most commonly a primitive (`reduce((sum,
// x) => sum + x.score, 0)`) — so flagging them produces too many
// false positives. The cases where reduce does build a new array
// (`reduce((acc, x) => [...acc, x], [])`) are typically intentional
// derivations the user has decided to colocate with the selector.
const ALLOCATING_ARRAY_METHODS = new Set([
  "filter",
  "map",
  "flatMap",
  "slice",
  "concat",
  "toSorted",
  "toReversed",
  "toSpliced",
  "with",
]);

// `Object.*` and `Array.*` helpers that return a fresh collection.
const ALLOCATING_NAMESPACE_CALLS = new Map<string, Set<string>>([
  ["Object", new Set(["keys", "values", "entries", "fromEntries", "assign"])],
  ["Array", new Set(["from", "of"])],
]);

const MESSAGE_DERIVATION = (methodName: string): string =>
  `\`.${methodName}(...)\` returns a new array every render, so your component redraws on every action.`;

const MESSAGE_NAMESPACE = (namespace: string, methodName: string): string =>
  `\`${namespace}.${methodName}(...)\` returns a new collection every render, so your component redraws on every action.`;

interface MethodAllocatingCallSite {
  readonly kind: "method";
  readonly method: string;
}

interface NamespaceAllocatingCallSite {
  readonly kind: "namespace";
  readonly namespace: string;
  readonly method: string;
}

type AllocatingCallSite = MethodAllocatingCallSite | NamespaceAllocatingCallSite;

type AllocatingCallSiteWithNode = AllocatingCallSite & { readonly node: EsTreeNode };

const getAllocatingCallSiteDescription = (expression: EsTreeNode): AllocatingCallSite | null => {
  const stripped = stripParenExpression(expression);
  if (!isNodeOfType(stripped, "CallExpression")) return null;
  const callee = stripped.callee;
  if (!isNodeOfType(callee, "MemberExpression")) return null;
  if (callee.computed) return null;
  if (!isNodeOfType(callee.property, "Identifier")) return null;
  const methodName = callee.property.name;

  if (isNodeOfType(callee.object, "Identifier")) {
    const namespaceName = callee.object.name;
    const allowedMethods = ALLOCATING_NAMESPACE_CALLS.get(namespaceName);
    if (allowedMethods?.has(methodName)) {
      return { kind: "namespace", namespace: namespaceName, method: methodName };
    }
  }

  if (ALLOCATING_ARRAY_METHODS.has(methodName)) {
    return { kind: "method", method: methodName };
  }

  return null;
};

// Returns the allocating call ONLY when the expression's RESULT is a
// fresh allocation — i.e. the call is the returned value, not merely
// nested somewhere in the returned subtree. This is what breaks the
// `===` equality: `s => s.users.filter(...)` returns a fresh array,
// but `s => s.users.filter(...).length` returns a stable number and
// `s => s.tags.map(...).join(",")` returns a stable string, so neither
// of those re-renders and neither should be flagged.
//
// Descends through the result-preserving expression forms
// (conditional / logical / sequence / parens) the same way React's
// `===` would see the eventual value.
const findReturnedAllocatingCall = (expression: EsTreeNode): AllocatingCallSiteWithNode | null => {
  const stripped = stripParenExpression(expression);

  const direct = getAllocatingCallSiteDescription(stripped);
  if (direct) return { ...direct, node: stripped };

  if (isNodeOfType(stripped, "ConditionalExpression")) {
    return (
      findReturnedAllocatingCall(stripped.consequent) ??
      findReturnedAllocatingCall(stripped.alternate)
    );
  }
  if (isNodeOfType(stripped, "LogicalExpression")) {
    return findReturnedAllocatingCall(stripped.left) ?? findReturnedAllocatingCall(stripped.right);
  }
  if (isNodeOfType(stripped, "SequenceExpression")) {
    const lastExpression = stripped.expressions[stripped.expressions.length - 1];
    return lastExpression ? findReturnedAllocatingCall(lastExpression) : null;
  }
  return null;
};

// useSelector callbacks should pick a slice and return it. When they
// instead derive a new array — `.filter`, `.map`, `.slice`, etc. — the
// fresh allocation breaks the default `===` equality, re-rendering on
// every dispatched action regardless of whether the underlying data
// changed. The fix is the same as the official Redux guidance:
//
//   1. Pull the raw slice in `useSelector`.
//   2. Derive with `useMemo`, or
//   3. Use a `createSelector` / `useSelector(selector, shallowEqual)` pair.
//
// Scope:
//   - Flags `useSelector` from `react-redux` AND same-file typed-
//     wrapper rebindings such as `const useAppSelector:
//     TypedUseSelectorHook<RootState> = useSelector` (the canonical
//     Redux Toolkit pattern). The cross-file form (typed wrapper in
//     `hooks.ts`, used elsewhere) requires module-graph resolution
//     and remains out of scope.
//   - Only fires when no second argument is passed (the second arg
//     usually carries `shallowEqual` or a custom equality fn).
//   - Recursion stops at nested functions inside the selector — those
//     run lazily and don't allocate on each store update.
//   - Covers `.filter / .map / .flatMap / .slice / .concat /
//     .toSorted / .toReversed / .toSpliced / .with` and
//     `Object.{keys,values,entries,fromEntries,assign}` /
//     `Array.{from,of}` namespace calls. `reduce` / `reduceRight`
//     are excluded because they can return any type (often a
//     primitive aggregation).
//   - Companion to `redux-useselector-returns-new-collection`, which
//     covers selectors returning a bare `{...}` / `[...]` literal.
export const reduxUseselectorInlineDerivation = defineRule({
  id: "redux-useselector-inline-derivation",
  title: "useSelector derives data inline",
  severity: "warn",
  category: "Performance",
  disabledWhen: ["react-compiler"],
  recommendation:
    "Select the raw slice and memoize derivation so Redux actions do not rebuild a collection and redraw this component.",
  create: (context: RuleContext) => {
    let aliases: ReadonlySet<string> = new Set<string>();
    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        aliases = collectReactReduxSelectorAliases(node as EsTreeNode);
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        const selectorArgument = inlineUseSelectorFunction(node, aliases);
        if (!selectorArgument) return;

        const body = selectorArgument.body;
        if (!body) return;

        // For concise arrows `(s) => s.users.filter(...)`, the body
        // IS the returned expression. For block bodies, only scan the
        // arguments of ReturnStatement nodes — intermediate
        // computations that aren't returned don't break `===`. Nested
        // functions are pruned: their returns run lazily, not on each
        // store update.
        const returnedExpressions: EsTreeNode[] = [];
        if (isNodeOfType(body, "BlockStatement")) {
          walkAst(body, (node) => {
            if (node !== body && isFunctionLike(node)) return false;
            if (isNodeOfType(node, "ReturnStatement")) {
              if (node.argument) returnedExpressions.push(node.argument);
              return false;
            }
            return undefined;
          });
        } else {
          returnedExpressions.push(body);
        }

        for (const returnedExpression of returnedExpressions) {
          const allocatingCall = findReturnedAllocatingCall(returnedExpression);
          if (!allocatingCall) continue;

          const reportMessage =
            allocatingCall.kind === "method"
              ? MESSAGE_DERIVATION(allocatingCall.method)
              : MESSAGE_NAMESPACE(allocatingCall.namespace, allocatingCall.method);

          context.report({ node: allocatingCall.node, message: reportMessage });
          return;
        }
      },
    };
  },
});
