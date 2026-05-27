import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isImportedFromModule } from "../../utils/find-import-source-for-name.js";
import { isAstNode } from "../../utils/is-ast-node.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

const REACT_REDUX_MODULE = "react-redux";

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
  `useSelector callback derives a new array via \`.${methodName}(...)\` on every store update — the default \`===\` equality check always fails on a fresh allocation, re-rendering the component on every dispatched action. Select the raw slice (\`useSelector(s => s.users)\`) and derive with \`useMemo\`, or hoist the derivation into a memoised \`createSelector\` from \`reselect\`.`;

const MESSAGE_NAMESPACE = (namespace: string, methodName: string): string =>
  `useSelector callback returns a fresh collection from \`${namespace}.${methodName}(...)\` on every store update — the default \`===\` equality check always fails, re-rendering on every dispatched action. Select the raw slice and derive with \`useMemo\` or \`reselect\`.`;

const isUseSelectorFromReactRedux = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
): boolean => {
  const callee = callExpression.callee;
  if (!isNodeOfType(callee, "Identifier")) return false;
  if (callee.name !== "useSelector") return false;
  return isImportedFromModule(callExpression, callee.name, REACT_REDUX_MODULE);
};

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

const findFirstAllocatingCallInExpression = (
  expression: EsTreeNode,
): AllocatingCallSiteWithNode | null => {
  let firstHit: AllocatingCallSiteWithNode | null = null;

  const visit = (node: EsTreeNode): void => {
    if (firstHit) return;
    // Don't recurse into nested functions — those run lazily.
    if (
      isNodeOfType(node, "ArrowFunctionExpression") ||
      isNodeOfType(node, "FunctionExpression") ||
      isNodeOfType(node, "FunctionDeclaration")
    ) {
      return;
    }

    const description = getAllocatingCallSiteDescription(node);
    if (description) {
      firstHit = { ...description, node };
      return;
    }

    const nodeRecord = node as unknown as Record<string, unknown>;
    for (const key of Object.keys(nodeRecord)) {
      if (key === "parent") continue;
      const child = nodeRecord[key];
      if (Array.isArray(child)) {
        for (const item of child) if (isAstNode(item)) visit(item);
      } else if (isAstNode(child)) {
        visit(child);
      }
    }
  };

  visit(expression);
  return firstHit;
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
// Scope (v1):
//   - Only flags `useSelector` imported as itself from `react-redux`.
//     Typed wrappers (`useAppSelector`, etc.) need cross-file resolution.
//   - Only fires when no second argument is passed (the second arg
//     usually carries `shallowEqual` or a custom equality fn).
//   - Recursion stops at nested functions inside the selector — those
//     run lazily and don't allocate on each store update.
//   - Covers `.filter / .map / .flatMap / .slice / .concat / .reduce /
//     .reduceRight / .toSorted / .toReversed / .toSpliced / .with` and
//     `Object.{keys,values,entries,fromEntries,assign}` /
//     `Array.{from,of}` namespace calls.
//   - Companion to `redux-useselector-returns-new-collection`, which
//     covers selectors returning a bare `{...}` / `[...]` literal.
export const reduxUseselectorInlineDerivation = defineRule<Rule>({
  id: "redux-useselector-inline-derivation",
  severity: "warn",
  category: "Performance",
  disabledBy: ["react-compiler"],
  recommendation:
    "Select the raw slice and derive with `useMemo`, or use `createSelector` from `reselect`.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isUseSelectorFromReactRedux(node)) return;
      const args = node.arguments ?? [];
      if (args.length === 0) return;
      if (args.length >= 2) return;

      const selectorArgument = stripParenExpression(args[0]);
      if (
        !isNodeOfType(selectorArgument, "ArrowFunctionExpression") &&
        !isNodeOfType(selectorArgument, "FunctionExpression")
      ) {
        return;
      }

      const body = selectorArgument.body;
      if (!body) return;

      const allocatingCall = findFirstAllocatingCallInExpression(body);
      if (!allocatingCall) return;

      const reportMessage =
        allocatingCall.kind === "method"
          ? MESSAGE_DERIVATION(allocatingCall.method)
          : MESSAGE_NAMESPACE(allocatingCall.namespace, allocatingCall.method);

      context.report({ node: allocatingCall.node, message: reportMessage });
    },
  }),
});
