import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

// Direct-callee names that produce a fresh value every call. The
// classic key-defeating shapes: `Math.random()`, `Date.now()`,
// `performance.now()`, `crypto.randomUUID()`, `crypto.getRandomValues()`,
// and `nanoid()` / `uuid()` / `uuidv4()` / `cuid()` / `ulid()` from the
// well-known id libraries.
//
// Matched unless the local name resolves to a same-file user-defined
// binding (see `isAlwaysFreshExpression`): a helper named `createId` /
// `v4` that returns a STABLE id would otherwise be a false positive.
const ALWAYS_FRESH_DIRECT_CALLEES = new Set([
  "nanoid",
  "uuid",
  "uuidv4",
  "uuidV4",
  "v4",
  "cuid",
  "cuid2",
  "createId",
  "ulid",
  "objectid",
  "ObjectId",
  "shortid",
]);

const ALWAYS_FRESH_MEMBER_RECEIVERS = new Map<string, ReadonlySet<string>>([
  ["Math", new Set(["random"])],
  ["Date", new Set(["now"])],
  ["performance", new Set(["now"])],
  ["crypto", new Set(["randomUUID", "getRandomValues", "randomBytes"])],
]);

const isAlwaysFreshExpression = (expression: EsTreeNode): string | null => {
  const stripped = stripParenExpression(expression);

  if (isNodeOfType(stripped, "NewExpression")) {
    if (isNodeOfType(stripped.callee, "Identifier") && stripped.callee.name === "Date") {
      return "new Date()";
    }
  }

  if (!isNodeOfType(stripped, "CallExpression")) return null;
  const callee = stripped.callee;

  if (isNodeOfType(callee, "Identifier")) {
    if (!ALWAYS_FRESH_DIRECT_CALLEES.has(callee.name)) return null;
    // Abstain only when the name resolves to a same-file user-defined
    // binding with its own initializer — a `function createId() {}` or
    // `const v4 = () => stable` helper that returns a STABLE id. Real
    // imported factories (and unresolved/global names) still flag.
    const binding = findVariableInitializer(callee, callee.name);
    if (
      binding?.initializer &&
      !isNodeOfType(binding.initializer, "ImportSpecifier") &&
      !isNodeOfType(binding.initializer, "ImportDefaultSpecifier") &&
      !isNodeOfType(binding.initializer, "ImportNamespaceSpecifier")
    ) {
      return null;
    }
    return `${callee.name}()`;
  }

  if (isNodeOfType(callee, "MemberExpression") && !callee.computed) {
    const receiver = callee.object;
    const property = callee.property;
    if (!isNodeOfType(property, "Identifier")) return null;

    if (isNodeOfType(receiver, "Identifier")) {
      const allowedProps = ALWAYS_FRESH_MEMBER_RECEIVERS.get(receiver.name);
      if (allowedProps?.has(property.name)) {
        return `${receiver.name}.${property.name}()`;
      }
    }

    // Common id-factory shape: `id.next()` / `idGen.create()` — too noisy
    // without scope analysis. Skip for v1.
  }

  return null;
};

// Best-effort label for the variable being mutated. Falls back to
// "counter" when the argument shape isn't a plain identifier — e.g.
// `++state.count` (MemberExpression) — so the diagnostic still reads
// naturally.
const variableLabelForUpdateArgument = (argument: EsTreeNode | null | undefined): string => {
  if (!argument) return "counter";
  const stripped = stripParenExpression(argument);
  if (isNodeOfType(stripped, "Identifier")) return stripped.name;
  if (
    isNodeOfType(stripped, "MemberExpression") &&
    !stripped.computed &&
    isNodeOfType(stripped.property, "Identifier")
  ) {
    return stripped.property.name;
  }
  return "counter";
};

const looksLikeFreshUpdateExpression = (expression: EsTreeNode): string | null => {
  const stripped = stripParenExpression(expression);
  if (isNodeOfType(stripped, "UpdateExpression")) {
    const label = variableLabelForUpdateArgument(stripped.argument);
    return stripped.prefix ? `${stripped.operator}${label}` : `${label}${stripped.operator}`;
  }
  if (
    isNodeOfType(stripped, "AssignmentExpression") &&
    (stripped.operator === "+=" || stripped.operator === "-=")
  ) {
    return `${stripped.operator} side-effect`;
  }
  return null;
};

// Flags `<X key={Math.random()} />`, `<X key={Date.now()} />`,
// `<X key={crypto.randomUUID()} />`, `<X key={nanoid()} />`, etc.
//
// A `key` that changes on every render defeats React's reconciliation:
// every list item is treated as a brand-new component. React unmounts
// the previous tree and mounts a fresh one. Three consequences:
//
//   1. Correctness: local state, focus, scroll position, controlled
//      input cursor, and CSS transition state all reset every render.
//   2. Performance: full unmount/mount tree work per render, no
//      reconciliation savings. The whole point of keys is gone.
//   3. Effects: every `useEffect(() => {}, [])` fires once per render
//      because the component is freshly mounted each time.
//
// Companion to `no-array-index-as-key` (which targets the milder bug
// of index-as-key when list order changes); this rule targets the
// catastrophic case where the key has no relationship to the item.
//
// LIMITATIONS:
//   - Doesn't follow identifier bindings (`const key = nanoid(); <X
//     key={key} />`) — the binding might be hoisted or memoised; we'd
//     need scope analysis to know.
//   - Doesn't model arbitrary user-defined factories. Adding a generic
//     "looks like an id generator" name list would over-report on
//     things like `getKey(item.id)` which is fine.
export const noRandomKey = defineRule<Rule>({
  id: "no-random-key",
  title: "Random value used as a key",
  severity: "error",
  category: "Correctness",
  recommendation:
    "Use a stable id from the item itself, like `item.id`, a content hash, or the index when the order never changes. Don't build the key from something that changes every time.",
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
      if (!isNodeOfType(node.name, "JSXIdentifier")) return;
      if (node.name.name !== "key") return;
      if (!node.value) return;
      if (!isNodeOfType(node.value, "JSXExpressionContainer")) return;
      const inner = node.value.expression;
      if (!inner) return;
      if (inner.type === "JSXEmptyExpression") return;

      const freshDescription =
        isAlwaysFreshExpression(inner) ?? looksLikeFreshUpdateExpression(inner);
      if (!freshDescription) return;

      context.report({
        node: node.value,
        message: `A changing key makes React rebuild each item, which can reset typed input, focus, and scroll position. Use a stable id from the item instead of \`key={${freshDescription}}\`.`,
      });
    },
  }),
});
