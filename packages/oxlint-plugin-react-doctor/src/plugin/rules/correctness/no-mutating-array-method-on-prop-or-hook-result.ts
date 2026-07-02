import { componentOrHookDisplayNameForFunction } from "../../utils/component-or-hook-display-name.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import type { BindingInfo } from "../../utils/find-variable-initializer.js";
import { getCalleeName } from "../../utils/get-callee-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactHookName } from "../../utils/is-react-hook-name.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { RuleContext } from "../../utils/rule-context.js";

interface AliasSource {
  rootIdentifier: EsTreeNodeOfType<"Identifier">;
  isMemberAccess: boolean;
}

// Only the in-place reorder/remove mutators this rule targets — a deliberate
// subset of the canonical `MUTATING_ARRAY_METHODS`; named distinctly so it does
// not shadow that nine-method set.
const REORDERING_ARRAY_METHODS = new Set(["sort", "reverse", "splice"]);

// Immer drafts and mutation-callback targets are deliberately mutable, and
// their binding names conventionally advertise it. Matched as whole camel /
// snake words so ordinary names that merely contain the letters (e.g.
// `permutations`) are not exempted.
const MUTATION_SAFE_WORDS = new Set(["draft", "mutable", "mutation"]);

const ALIAS_RESOLUTION_DEPTH_LIMIT = 3;

const identifierWords = (name: string): string[] =>
  name
    .split(/[^a-zA-Z]+/)
    .flatMap((chunk) => chunk.split(/(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/))
    .filter(Boolean);

const hasMutationSafeWord = (name: string): boolean =>
  identifierWords(name).some((word) => MUTATION_SAFE_WORDS.has(word.toLowerCase()));

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

// Stops at function boundaries so a callback parameter nested inside a hook
// call (`const handler = useCallback((rows) => rows.sort(), [])`) never
// tunnels out to the enclosing declarator and gets misread as a hook result.
const nearestVariableDeclarator = (
  node: EsTreeNode,
): EsTreeNodeOfType<"VariableDeclarator"> | null => {
  let cursor: EsTreeNode | null | undefined = node;
  while (cursor) {
    if (isNodeOfType(cursor, "VariableDeclarator")) return cursor;
    if (isNodeOfType(cursor, "VariableDeclaration") || isFunctionLike(cursor)) return null;
    cursor = cursor.parent ?? null;
  }
  return null;
};

// A rest-element destructuring binding (`const [a, ...rest] = arr`,
// `const { a, ...rest } = obj`) materializes a freshly allocated array /
// object, so mutating the binding itself never touches the source. Member
// access through the binding (`rest.items.sort()`) still reaches shared
// inner values and stays flagged.
const isBoundThroughRestElement = (binding: BindingInfo): boolean => {
  let cursor: EsTreeNode | null | undefined = binding.bindingIdentifier;
  while (cursor && !isNodeOfType(cursor, "VariableDeclarator") && !isFunctionLike(cursor)) {
    if (isNodeOfType(cursor, "RestElement")) return true;
    cursor = cursor.parent ?? null;
  }
  return false;
};

const declaratorInitFor = (binding: BindingInfo): EsTreeNode | null => {
  const declarator = nearestVariableDeclarator(binding.bindingIdentifier);
  return declarator ? ((declarator.init as EsTreeNode | null) ?? null) : null;
};

const isDerivedFromHookCall = (binding: BindingInfo): boolean => {
  if (binding.initializer && isHookCallExpression(stripParenExpression(binding.initializer))) {
    return true;
  }
  // Destructured hook result: `const { data } = useQuery()`.
  const declaratorInit = declaratorInitFor(binding);
  return Boolean(declaratorInit && isHookCallExpression(stripParenExpression(declaratorInit)));
};

// `const [store] = useState({...})` with the setter never destructured is the
// deliberate ref-like mutable-container idiom (same rationale as the
// `.current` carve-out). Only applies when the array is reached through a
// member access on the container — direct `stateArray.sort()` stays flagged.
const isSetterlessUseStateBinding = (binding: BindingInfo): boolean => {
  const declarator = nearestVariableDeclarator(binding.bindingIdentifier);
  if (!declarator || !isNodeOfType(declarator.id, "ArrayPattern")) return false;
  const boundElements = declarator.id.elements.filter(Boolean);
  if (boundElements.length !== 1) return false;
  if (!declarator.init) return false;
  return getCalleeName(stripParenExpression(declarator.init as EsTreeNode)) === "useState";
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

// oxlint runtime nodes carry `range`; the oxc-parser test AST carries
// numeric `start`/`end` fields instead — accept either.
const nodeSpan = (node: EsTreeNode): [number, number] | null => {
  if (node.range) return [node.range[0], node.range[1]];
  const nodeWithOffsets = node as { start?: number; end?: number };
  if (typeof nodeWithOffsets.start === "number" && typeof nodeWithOffsets.end === "number") {
    return [nodeWithOffsets.start, nodeWithOffsets.end];
  }
  return null;
};

// `events = events.filter(...)` before the flagged call rebinds the name to a
// fresh array, so the mutating call no longer touches the prop / hook result.
// The assignment must complete before the call starts, so `items = items.sort()`
// (which still mutates the shared array in place) stays flagged.
const hasRebindBeforeCall = (
  binding: BindingInfo,
  identifierName: string,
  callNode: EsTreeNodeOfType<"CallExpression">,
): boolean => {
  const callSpan = nodeSpan(callNode);
  const bindingSpan = nodeSpan(binding.bindingIdentifier);
  if (!callSpan || !bindingSpan) return false;
  let didFindRebind = false;
  walkAst(binding.scopeOwner, (candidate) => {
    if (didFindRebind) return false;
    if (
      isNodeOfType(candidate, "AssignmentExpression") &&
      candidate.operator === "=" &&
      isNodeOfType(candidate.left, "Identifier") &&
      candidate.left.name === identifierName
    ) {
      const assignmentSpan = nodeSpan(candidate);
      if (
        assignmentSpan &&
        assignmentSpan[0] > bindingSpan[0] &&
        assignmentSpan[1] <= callSpan[0]
      ) {
        didFindRebind = true;
        return false;
      }
    }
    return undefined;
  });
  return didFindRebind;
};

// Body-level prop aliases: `const { items } = props` / `const list = props.items`
// keep pointing at the parent's array, so follow the initializer chain back to
// its root identifier. Copies (`[...items]`, `items.slice()`) are call / array
// expressions and produce no alias, and a `.current` chain stays exempt.
const aliasSourceFor = (binding: BindingInfo): AliasSource | null => {
  const aliasCandidates = [binding.initializer, declaratorInitFor(binding)];
  for (const aliasCandidate of aliasCandidates) {
    if (!aliasCandidate) continue;
    const strippedCandidate = stripParenExpression(aliasCandidate);
    if (isNodeOfType(strippedCandidate, "Identifier")) {
      return { rootIdentifier: strippedCandidate, isMemberAccess: false };
    }
    if (
      isNodeOfType(strippedCandidate, "MemberExpression") &&
      !receiverReachesThroughRefCurrent(strippedCandidate)
    ) {
      const aliasRoot = rootIdentifierNode(strippedCandidate);
      if (aliasRoot) return { rootIdentifier: aliasRoot, isMemberAccess: true };
    }
  }
  return null;
};

type SharedArraySource = "prop" | "hook-result";

const resolveSharedArraySource = (
  rootIdentifier: EsTreeNodeOfType<"Identifier">,
  callNode: EsTreeNodeOfType<"CallExpression">,
  reachesThroughMemberAccess: boolean,
  depth: number,
): SharedArraySource | null => {
  if (depth > ALIAS_RESOLUTION_DEPTH_LIMIT) return null;
  if (hasMutationSafeWord(rootIdentifier.name)) return null;
  const binding = findVariableInitializer(rootIdentifier, rootIdentifier.name);
  if (!binding) return null;
  if (hasRebindBeforeCall(binding, rootIdentifier.name, callNode)) return null;
  if (!reachesThroughMemberAccess && isBoundThroughRestElement(binding)) return null;
  if (isDerivedFromHookCall(binding)) {
    if (reachesThroughMemberAccess && isSetterlessUseStateBinding(binding)) return null;
    return "hook-result";
  }
  // A parameter of a React component (or hook) is a prop — shared with
  // the parent across renders. Plain-function/utility params and the
  // draft/mutation params of `produce`/`useMutation` callbacks are not
  // components, so they never reach this branch.
  if (isParameterBinding(binding)) {
    return componentOrHookDisplayNameForFunction(binding.scopeOwner) ? "prop" : null;
  }
  const aliasSource = aliasSourceFor(binding);
  if (!aliasSource) return null;
  return resolveSharedArraySource(
    aliasSource.rootIdentifier,
    callNode,
    reachesThroughMemberAccess || aliasSource.isMemberAccess,
    depth + 1,
  );
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

      const receiverIsMemberAccess = isNodeOfType(receiver, "MemberExpression");
      const source = resolveSharedArraySource(rootIdentifier, node, receiverIsMemberAccess, 0);
      if (!source) return;
      context.report({ node, message: messageFor(source) });
    },
  }),
});
