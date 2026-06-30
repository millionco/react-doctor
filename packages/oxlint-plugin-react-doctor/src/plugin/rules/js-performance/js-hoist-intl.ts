import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
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

// A lazily-memoized formatter factory — `if (!cache.has(k)) cache.set(k,
// new Intl…)`, `cache.get(k) ?? (cache[k] = new Intl…)`, `store[k] ??= new
// Intl…` — only allocates once per distinct key, then reuses the cached
// instance. That is the hand-rolled version of the optimisation this rule
// recommends, so it must not be flagged. Detect the `new Intl.*` being
// assigned through a memo-assignment or guarded by a cache-membership
// check between it and its enclosing function.
const CACHE_LOOKUP_METHOD_NAMES = new Set(["has", "get", "includes"]);
const CACHE_WRITE_METHOD_NAMES = new Set(["set", "push"]);
const MEMO_ASSIGNMENT_OPERATORS = new Set(["??=", "||="]);

const testReferencesCacheLookup = (test: EsTreeNode | null | undefined): boolean => {
  if (!test) return false;
  let found = false;
  walkAst(test, (child: EsTreeNode) => {
    if (found) return false;
    if (
      isNodeOfType(child, "CallExpression") &&
      isNodeOfType(child.callee, "MemberExpression") &&
      isNodeOfType(child.callee.property, "Identifier") &&
      CACHE_LOOKUP_METHOD_NAMES.has(child.callee.property.name)
    ) {
      found = true;
    }
  });
  return found;
};

const isInsideCacheMemo = (node: EsTreeNode): boolean => {
  let child: EsTreeNode = node;
  let cursor: EsTreeNode | null = node.parent ?? null;
  while (cursor) {
    if (isFunctionLike(cursor)) return false;
    if (
      isNodeOfType(cursor, "AssignmentExpression") &&
      cursor.right === child &&
      MEMO_ASSIGNMENT_OPERATORS.has(cursor.operator)
    ) {
      return true;
    }
    if (
      isNodeOfType(cursor, "CallExpression") &&
      isNodeOfType(cursor.callee, "MemberExpression") &&
      isNodeOfType(cursor.callee.property, "Identifier") &&
      CACHE_WRITE_METHOD_NAMES.has(cursor.callee.property.name) &&
      (cursor.arguments ?? []).some((argument) => argument === child)
    ) {
      return true;
    }
    if (isNodeOfType(cursor, "IfStatement") && testReferencesCacheLookup(cursor.test)) {
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
      if (isInsideCacheMemo(node)) return;
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
