import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { getRootIdentifierName } from "../../utils/get-root-identifier-name.js";
import { isAstDescendant } from "../../utils/is-ast-descendant.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";

// HACK: `new Intl.NumberFormat()` / `Intl.DateTimeFormat()` is expensive
// (dozens of allocations per locale lookup). Allocating it inside a render
// function or hot loop tanks scroll/list perf. Hoist to module scope or
// wrap in useMemo.
const INTL_CLASSES = new Set([
  "NumberFormat",
  "DateTimeFormat",
  "Collator",
  "RelativeTimeFormat",
  "ListFormat",
  "PluralRules",
  "Segmenter",
  "DisplayNames",
]);

// A lazily-memoized formatter factory only allocates once per distinct key,
// then reuses the cached instance — the hand-rolled version of the
// optimisation this rule recommends, so it must not be flagged. Each exempt
// shape correlates the `new Intl.*` with an actual cache read or write:
//   - `store[k] ??= new Intl…` (and `||=`)
//   - `f = new Intl…` where `f` was initialized from a `.get(...)` lookup
//     (`let f = cache.get(k); if (!f) { f = new Intl…; cache.set(k, f); }`)
//   - `cache.set(k, new Intl…)` where the NewExpression is the DIRECT
//     argument and `cache` is declared outside the enclosing function —
//     `url.searchParams.set("total", new Intl….format(total))` and a fresh
//     per-call Map are not reuse across calls, so they still flag
//   - `cache.get(k) ?? (cache[k] = new Intl…)` / `cache[k] || new Intl…`
//   - `cache.has(k) ? cache.get(k) : new Intl…`
//   - `if (!cache.has(k)) { … new Intl… }` only when the guarded branch also
//     writes the cache (`.set`, index-assign, or assign to a looked-up
//     identifier) — an unrelated `.includes` guard alone does not exempt
// `array.push(new Intl…)` just accumulates allocations — NOT keyed reuse —
// so it does not exempt either.
const CACHE_LOOKUP_METHOD_NAMES = new Set(["has", "get", "includes"]);
const CACHE_WRITE_METHOD_NAMES = new Set(["set"]);
const MEMO_ASSIGNMENT_OPERATORS = new Set(["??=", "||="]);
const MEMO_LOGICAL_OPERATORS = new Set(["??", "||"]);

const isCacheLookupCall = (expression: EsTreeNode | null | undefined): boolean => {
  if (!expression) return false;
  const strippedExpression = stripParenExpression(expression);
  return (
    isNodeOfType(strippedExpression, "CallExpression") &&
    isNodeOfType(strippedExpression.callee, "MemberExpression") &&
    isNodeOfType(strippedExpression.callee.property, "Identifier") &&
    CACHE_LOOKUP_METHOD_NAMES.has(strippedExpression.callee.property.name)
  );
};

const containsCacheLookup = (expression: EsTreeNode | null | undefined): boolean => {
  if (!expression) return false;
  let didFindLookup = false;
  walkAst(expression, (candidate: EsTreeNode) => {
    if (didFindLookup) return false;
    if (
      isCacheLookupCall(candidate) ||
      (isNodeOfType(candidate, "MemberExpression") && candidate.computed)
    ) {
      didFindLookup = true;
      return false;
    }
  });
  return didFindLookup;
};

const isIdentifierInitializedFromCacheLookup = (
  identifier: EsTreeNodeOfType<"Identifier">,
): boolean => {
  const binding = findVariableInitializer(identifier, identifier.name);
  return Boolean(binding?.initializer && isCacheLookupCall(binding.initializer));
};

const containsCacheWrite = (region: EsTreeNode | null | undefined): boolean => {
  if (!region) return false;
  let didFindWrite = false;
  walkAst(region, (candidate: EsTreeNode) => {
    if (didFindWrite) return false;
    if (
      isNodeOfType(candidate, "CallExpression") &&
      isNodeOfType(candidate.callee, "MemberExpression") &&
      isNodeOfType(candidate.callee.property, "Identifier") &&
      CACHE_WRITE_METHOD_NAMES.has(candidate.callee.property.name)
    ) {
      didFindWrite = true;
      return false;
    }
    if (isNodeOfType(candidate, "AssignmentExpression")) {
      const writeTarget = candidate.left;
      if (
        (isNodeOfType(writeTarget, "MemberExpression") && writeTarget.computed) ||
        (isNodeOfType(writeTarget, "Identifier") &&
          isIdentifierInitializedFromCacheLookup(writeTarget))
      ) {
        didFindWrite = true;
        return false;
      }
    }
  });
  return didFindWrite;
};

const isPersistentCacheSetWrite = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
  newExpression: EsTreeNode,
  enclosingFunction: EsTreeNode | null,
): boolean => {
  if (
    !isNodeOfType(callExpression.callee, "MemberExpression") ||
    !isNodeOfType(callExpression.callee.property, "Identifier") ||
    !CACHE_WRITE_METHOD_NAMES.has(callExpression.callee.property.name)
  ) {
    return false;
  }
  const isDirectArgument = (callExpression.arguments ?? []).some(
    (argument) => argument === newExpression,
  );
  if (!isDirectArgument) return false;
  if (!enclosingFunction) return true;
  const receiverExpression = callExpression.callee.object;
  const receiverRootName = getRootIdentifierName(receiverExpression);
  if (!receiverRootName) return true;
  const receiverBinding = findVariableInitializer(receiverExpression, receiverRootName);
  if (!receiverBinding) return true;
  return !isAstDescendant(receiverBinding.scopeOwner, enclosingFunction);
};

const isInsideCacheMemo = (node: EsTreeNode): boolean => {
  const enclosingFunction = findEnclosingFunction(node);
  let child: EsTreeNode = node;
  let cursor: EsTreeNode | null = node.parent ?? null;
  while (cursor) {
    if (isFunctionLike(cursor)) return false;
    if (isNodeOfType(cursor, "AssignmentExpression") && cursor.right === child) {
      if (MEMO_ASSIGNMENT_OPERATORS.has(cursor.operator)) return true;
      if (
        cursor.operator === "=" &&
        isNodeOfType(cursor.left, "Identifier") &&
        isIdentifierInitializedFromCacheLookup(cursor.left)
      ) {
        return true;
      }
    }
    if (
      isNodeOfType(cursor, "CallExpression") &&
      isPersistentCacheSetWrite(cursor, node, enclosingFunction)
    ) {
      return true;
    }
    if (
      isNodeOfType(cursor, "LogicalExpression") &&
      MEMO_LOGICAL_OPERATORS.has(cursor.operator) &&
      cursor.right === child &&
      containsCacheLookup(cursor.left)
    ) {
      return true;
    }
    if (
      isNodeOfType(cursor, "ConditionalExpression") &&
      (cursor.consequent === child || cursor.alternate === child) &&
      containsCacheLookup(cursor.test)
    ) {
      return true;
    }
    if (
      isNodeOfType(cursor, "IfStatement") &&
      (cursor.consequent === child || cursor.alternate === child) &&
      containsCacheLookup(cursor.test) &&
      containsCacheWrite(child)
    ) {
      return true;
    }
    child = cursor;
    cursor = cursor.parent ?? null;
  }
  return false;
};

const isIntlNewExpression = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "NewExpression")) return false;
  const callee = node.callee;
  if (
    isNodeOfType(callee, "MemberExpression") &&
    isNodeOfType(callee.object, "Identifier") &&
    callee.object.name === "Intl" &&
    isNodeOfType(callee.property, "Identifier") &&
    INTL_CLASSES.has(callee.property.name)
  ) {
    return true;
  }
  return false;
};

export const jsHoistIntl = defineRule({
  id: "js-hoist-intl",
  title: "Intl formatter rebuilt each call",
  tags: ["test-noise"],
  severity: "warn",
  recommendation:
    "Move `new Intl.NumberFormat(...)` to the top of the file or wrap it in `useMemo`. Building one is slow, so don't redo it on every call",
  create: (context: RuleContext) => ({
    NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
      if (!isIntlNewExpression(node)) return;
      // Walk up: if any enclosing function is a function/arrow, this is in
      // a function body. Module-scope `new Intl.X()` is fine; we only flag
      // when wrapped in a function (likely called per render or per item).
      // Also skip if the immediately enclosing function is the callback of
      // a `useMemo`/`useCallback` — the value is already memoized so
      // re-allocation only happens when deps change, which is the same
      // outcome as hoisting plus locale-conditional behaviour.
      let cursor: EsTreeNode | null = node.parent ?? null;
      let inFunctionBody = false;
      while (cursor) {
        if (isFunctionLike(cursor)) {
          inFunctionBody = true;
          // Detect the `useMemo(() => …)` / `useCallback(() => …)` shape:
          // the function is the first argument of a CallExpression whose
          // callee identifier is one of these hook names.
          const fnParent = cursor.parent;
          if (
            fnParent &&
            isNodeOfType(fnParent, "CallExpression") &&
            fnParent.arguments?.[0] === cursor
          ) {
            const callee = fnParent.callee;
            const calleeName = isNodeOfType(callee, "Identifier")
              ? callee.name
              : isNodeOfType(callee, "MemberExpression") &&
                  isNodeOfType(callee.property, "Identifier")
                ? callee.property.name
                : null;
            // `memo(Component)` only short-circuits re-renders when
            // props are shallow-equal. When props DO change, the body
            // (and the `new Intl.*()`) still runs each render. It is
            // intentionally NOT in this list.
            if (
              calleeName === "useMemo" ||
              calleeName === "useCallback" ||
              calleeName === "useRef"
            ) {
              return;
            }
          }
          break;
        }
        cursor = cursor.parent ?? null;
      }
      if (!inFunctionBody) return;
      if (isInsideCacheMemo(node)) return;

      const className =
        isNodeOfType(node.callee, "MemberExpression") &&
        isNodeOfType(node.callee.property, "Identifier")
          ? node.callee.property.name
          : "Intl";
      context.report({
        node,
        message: `This is slow because new Intl.${className}() rebuilds on every call inside a function, so move it to the top of the file, or wrap it in useMemo`,
      });
    },
  }),
});
