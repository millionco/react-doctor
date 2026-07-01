import { componentOrHookDisplayNameForFunction } from "../../utils/component-or-hook-display-name.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import type { BindingInfo } from "../../utils/find-variable-initializer.js";
import { getCalleeName } from "../../utils/get-callee-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactHookName } from "../../utils/is-react-hook-name.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { RuleContext } from "../../utils/rule-context.js";

// Only the in-place reorder/remove mutators this rule targets — a deliberate
// subset of the canonical `MUTATING_ARRAY_METHODS`; named distinctly so it does
// not shadow that nine-method set.
const REORDERING_ARRAY_METHODS = new Set(["sort", "reverse", "splice"]);

// Immer drafts and mutation-callback targets are deliberately mutable.
// Their binding names conventionally advertise it.
const MUTATION_SAFE_NAME_PATTERN = /draft|mutable|mutation/i;

// A `.current` in the receiver chain (`stackRef.current.splice()`,
// `mapRef.current[key].splice()`) means the array lives inside a React ref.
// `useRef` is itself a hook, so the root would otherwise be misclassified as
// a "hook result" — but a ref is a deliberately mutable container the docs
// endorse mutating, not shared/cached state, so mutating it is not the bug
// this rule targets. (useState arrays keep no such contract and stay flagged.)
const receiverReachesThroughRefCurrent = (receiver: EsTreeNode): boolean => {
  let cursor: EsTreeNode = receiver;
  while (isNodeOfType(cursor, "MemberExpression")) {
    if (
      !cursor.computed &&
      isNodeOfType(cursor.property, "Identifier") &&
      cursor.property.name === "current"
    ) {
      return true;
    }
    cursor = stripParenExpression(cursor.object as EsTreeNode);
  }
  return false;
};

const rootIdentifierNode = (node: EsTreeNode): EsTreeNodeOfType<"Identifier"> | null => {
  let cursor: EsTreeNode | null | undefined = node;
  while (cursor) {
    if (isNodeOfType(cursor, "Identifier")) return cursor;
    if (isNodeOfType(cursor, "ChainExpression")) {
      cursor = cursor.expression as unknown as EsTreeNode;
      continue;
    }
    if (isNodeOfType(cursor, "MemberExpression")) {
      cursor = cursor.object;
      continue;
    }
    return null;
  }
  return null;
};

const isHookCallExpression = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  const calleeName = getCalleeName(node);
  return calleeName !== null && isReactHookName(calleeName);
};

const nearestVariableDeclaratorInit = (node: EsTreeNode): EsTreeNode | null => {
  let cursor: EsTreeNode | null | undefined = node;
  while (cursor) {
    if (isNodeOfType(cursor, "VariableDeclarator")) {
      return (cursor.init as EsTreeNode | null) ?? null;
    }
    if (isNodeOfType(cursor, "VariableDeclaration")) return null;
    cursor = cursor.parent ?? null;
  }
  return null;
};

const isDerivedFromHookCall = (binding: BindingInfo): boolean => {
  if (binding.initializer && isHookCallExpression(stripParenExpression(binding.initializer))) {
    return true;
  }
  // Destructured hook result: `const { data } = useQuery()`.
  const declaratorInit = nearestVariableDeclaratorInit(binding.bindingIdentifier);
  return Boolean(declaratorInit && isHookCallExpression(stripParenExpression(declaratorInit)));
};

// True when the binding is a parameter of its scope-owning function
// (rather than a local declaration inside it).
const isParameterBinding = (binding: BindingInfo): boolean => {
  const owner = binding.scopeOwner;
  const params = (owner as { params?: EsTreeNode[] }).params;
  if (!Array.isArray(params)) return false;
  let cursor: EsTreeNode | null | undefined = binding.bindingIdentifier;
  while (cursor && cursor !== owner) {
    if (params.includes(cursor)) return true;
    cursor = cursor.parent ?? null;
  }
  return false;
};

type SharedArraySource = "prop" | "hook-result";

const resolveSharedArraySource = (
  rootIdentifier: EsTreeNodeOfType<"Identifier">,
): SharedArraySource | null => {
  const binding = findVariableInitializer(rootIdentifier, rootIdentifier.name);
  if (!binding) return null;
  if (isDerivedFromHookCall(binding)) return "hook-result";
  // A parameter of a React component (or hook) is a prop — shared with
  // the parent across renders. Plain-function/utility params and the
  // draft/mutation params of `produce`/`useMutation` callbacks are not
  // components, so they never reach this branch.
  if (isParameterBinding(binding) && componentOrHookDisplayNameForFunction(binding.scopeOwner)) {
    return "prop";
  }
  return null;
};

const messageFor = (source: SharedArraySource): string => {
  const origin =
    source === "prop"
      ? "a prop, so you mutate the parent's array"
      : "a hook result, so you mutate shared/cached state";
  return `\`sort\`, \`reverse\`, and \`splice\` mutate the array in place; this one comes from ${origin} and corrupts it across renders and components. Copy it first with \`[...array]\` or use \`toSorted\`/\`toReversed\`.`;
};

export const noMutatingArrayMethodOnPropOrHookResult = defineRule({
  id: "no-mutating-array-method-on-prop-or-hook-result",
  title: "In-place array mutation on a prop or hook result",
  severity: "warn",
  recommendation:
    "`sort`, `reverse`, and `splice` mutate in place, so calling them on a prop or hook result corrupts shared state. Copy the array first (`[...array]`) or use the immutable `toSorted`/`toReversed`/`toSpliced`.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      const callee = node.callee;
      if (!isNodeOfType(callee, "MemberExpression") || callee.computed) return;
      if (!isNodeOfType(callee.property, "Identifier")) return;
      if (!REORDERING_ARRAY_METHODS.has(callee.property.name)) return;

      const receiver = stripParenExpression(callee.object as EsTreeNode);
      if (receiverReachesThroughRefCurrent(receiver)) return;
      const rootIdentifier = rootIdentifierNode(receiver);
      if (!rootIdentifier) return;
      if (MUTATION_SAFE_NAME_PATTERN.test(rootIdentifier.name)) return;

      const source = resolveSharedArraySource(rootIdentifier);
      if (!source) return;
      context.report({ node, message: messageFor(source) });
    },
  }),
});
