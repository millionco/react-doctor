import { ITERATOR_PRODUCING_METHOD_NAMES } from "../../constants/js.js";
import { areExpressionsStructurallyEqual } from "../../utils/are-expressions-structurally-equal.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isMemberProperty } from "../../utils/is-member-property.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { walkAst } from "../../utils/walk-ast.js";

// Method calls whose result is a *brand new* array or an iterator with
// no `toSorted()`. Spreading either before `.sort()` is not a wasteful
// copy of a shared array: iterators (`values`/`keys`/`entries`) have no
// `toSorted()` at all, so the suggested rewrite wouldn't even run, and a
// freshly produced array (`map`/`filter`/…) is private throwaway data.
const FRESH_ARRAY_PRODUCING_METHOD_NAMES: ReadonlySet<string> = new Set([
  ...ITERATOR_PRODUCING_METHOD_NAMES,
  "map",
  "filter",
  "flatMap",
  "slice",
  "concat",
  "from",
]);

const isFreshOrIteratorAllocation = (node: EsTreeNode | null | undefined): boolean => {
  if (!node) return false;
  if (isNodeOfType(node, "ArrayExpression")) return true;
  // `[...new Set(x)].sort()` / `[...new Map(...).values()]` — spreading a
  // freshly constructed iterable allocates a private throwaway array, not a
  // copy of a shared binding, and many iterables have no `toSorted()` at all.
  if (isNodeOfType(node, "NewExpression")) return true;
  if (!isNodeOfType(node, "CallExpression")) return false;
  const callee = node.callee;
  return (
    isNodeOfType(callee, "MemberExpression") &&
    isNodeOfType(callee.property, "Identifier") &&
    FRESH_ARRAY_PRODUCING_METHOD_NAMES.has(callee.property.name)
  );
};

// A `new Set(…)` / `new Map(…)` construction or an iterator-producing call:
// values with no `toSorted()` at all, so `[...x].sort()` is a mandatory
// conversion no matter how many other references the binding has.
const isNonArrayIterableAllocation = (node: EsTreeNode | null | undefined): boolean => {
  if (!node) return false;
  if (isNodeOfType(node, "NewExpression")) {
    return !(isNodeOfType(node.callee, "Identifier") && node.callee.name === "Array");
  }
  if (!isNodeOfType(node, "CallExpression")) return false;
  const callee = node.callee;
  return (
    isNodeOfType(callee, "MemberExpression") &&
    isNodeOfType(callee.property, "Identifier") &&
    ITERATOR_PRODUCING_METHOD_NAMES.has(callee.property.name)
  );
};

const isSpreadOfNonArrayIterableBinding = (spreadArgument: EsTreeNode): boolean => {
  if (!isNodeOfType(spreadArgument, "Identifier")) return false;
  const binding = findVariableInitializer(spreadArgument, spreadArgument.name);
  if (!binding?.initializer) return false;
  if (!isNodeOfType(binding.bindingIdentifier.parent, "VariableDeclarator")) return false;
  return isNonArrayIterableAllocation(binding.initializer);
};

// `.size` is a Set/Map property (arrays have `.length`): a `x.size` read on
// the spread source anywhere in the enclosing function proves the spread is
// a Set/Map-to-array conversion, not a wasteful array copy.
const hasSizeReadOnSameExpression = (spreadArgument: EsTreeNode): boolean => {
  let scopeOwner: EsTreeNode = spreadArgument;
  let ancestor: EsTreeNode | null | undefined = spreadArgument.parent;
  while (ancestor) {
    scopeOwner = ancestor;
    if (isFunctionLike(ancestor)) break;
    ancestor = ancestor.parent ?? null;
  }
  let didFindSizeRead = false;
  walkAst(scopeOwner, (child: EsTreeNode) => {
    if (didFindSizeRead) return false;
    if (!isMemberProperty(child, "size")) return;
    if (areExpressionsStructurallyEqual(child.object, spreadArgument)) {
      didFindSizeRead = true;
    }
  });
  return didFindSizeRead;
};

export const jsTosortedImmutable = defineRule({
  id: "js-tosorted-immutable",
  title: "Spread copy before sort()",
  tags: ["test-noise"],
  severity: "warn",
  // Hermes (the default React Native / Expo JS engine) hasn't shipped
  // the ES2023 change-array-by-copy methods, so `array.toSorted()`
  // throws `undefined is not a function` at runtime. Recommending it in
  // an RN/Expo project would turn working `[...array].sort()` code into
  // a crash, so the gate drops this rule there. See issue #543.
  // `pre-es2023` catches web projects whose tsconfig `target` / `lib`
  // predates ES2023 — applying the suggestion would produce a type error
  // (`Property 'toSorted' does not exist`) and/or a runtime crash on
  // browsers without the method. See issue #750.
  disabledWhen: ["react-native", "pre-es2023"],
  recommendation:
    "Use `array.toSorted()` (ES2023) instead of `[...array].sort()` so you sort without copying the array first",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isMemberProperty(node.callee, "sort")) return;
      const receiver = node.callee.object;
      if (
        isNodeOfType(receiver, "ArrayExpression") &&
        receiver.elements?.length === 1 &&
        isNodeOfType(receiver.elements[0], "SpreadElement")
      ) {
        const spreadArgument = receiver.elements[0].argument as EsTreeNode;
        if (isFreshOrIteratorAllocation(spreadArgument)) return;
        if (isSpreadOfNonArrayIterableBinding(spreadArgument)) return;
        if (hasSizeReadOnSameExpression(spreadArgument)) return;
        context.report({
          node,
          message:
            "This wastes work because [...array].sort() copies the array just to sort it, so use array.toSorted() to sort without the extra copy (ES2023)",
        });
      }
    },
  }),
});
