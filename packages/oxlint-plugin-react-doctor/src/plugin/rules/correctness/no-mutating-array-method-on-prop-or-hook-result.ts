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
import { nodeDominatesNode } from "../../utils/node-dominates-node.js";
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

// `reverse()` / `sort()` also live on playback controllers (WAAPI
// Animation, GSAP Timeline/Tween) and sort-strategy objects, where they
// control playback direction or take the DATA as an argument — not
// Array.prototype mutators. Receivers named for those shapes stay quiet.
const NON_ARRAY_RECEIVER_NAME_PATTERN = /anim|timeline|tween|player|motion|strateg|sorter/i;

// Playback-control methods that never exist on arrays: a sibling
// `animation.pause()` / `timeline.play()` on the same receiver proves the
// `.reverse()` is playback control.
const PLAYBACK_SIBLING_METHOD_NAMES = new Set([
  "play",
  "pause",
  "cancel",
  "finish",
  "resume",
  "restart",
]);

// Store hooks whose entire API is mutate-the-proxy: MobX observables,
// SyncedStore/Yjs CRDT proxies, valtio proxies — splicing them IS the
// documented update mechanism, and a spread copy would silently break
// sync. `useCreation` (ahooks) is a documented useRef replacement, so the
// held instance is a deliberate mutable container like `.current`.
const MUTABLE_STORE_HOOK_PATTERN = /^use(?:LocalObservable|LocalStore|SyncedStore|Proxy|Creation)$/;

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

const isMutableStoreHookCall = (node: EsTreeNode | null): boolean => {
  if (!node || !isNodeOfType(node, "CallExpression")) return false;
  const calleeName = getCalleeName(node);
  return calleeName !== null && MUTABLE_STORE_HOOK_PATTERN.test(calleeName);
};

// The same receiver gets playback-control calls (`animation.pause()`,
// `timeline.play()`) somewhere in the file — it is a WAAPI Animation /
// GSAP Timeline, not an array.
const scopeShowsPlaybackSiblingCall = (
  rootIdentifier: EsTreeNodeOfType<"Identifier">,
  context: RuleContext,
): boolean => {
  const symbol = context.scopes.symbolFor(rootIdentifier);
  return Boolean(
    symbol?.references.some((reference) => {
      const member = reference.identifier.parent;
      return Boolean(
        member &&
        isNodeOfType(member, "MemberExpression") &&
        member.object === reference.identifier &&
        !member.computed &&
        isNodeOfType(member.property, "Identifier") &&
        PLAYBACK_SIBLING_METHOD_NAMES.has(member.property.name) &&
        isNodeOfType(member.parent, "CallExpression") &&
        member.parent.callee === member,
      );
    }),
  );
};

// `useEffect(() => { locks.push(id); return () => { locks.splice(...); }; })`
// — the subscribe/unsubscribe registry idiom: the mutation lives in the
// effect's cleanup and the effect body registered into the same container.
const isRegistryCleanupMutation = (callNode: EsTreeNode, rootIdentifierName: string): boolean => {
  let cleanupFunction: EsTreeNode | null = null;
  let ancestor: EsTreeNode | null | undefined = callNode.parent;
  while (ancestor) {
    if (isFunctionLike(ancestor)) {
      cleanupFunction = ancestor;
      break;
    }
    ancestor = ancestor.parent ?? null;
  }
  if (!cleanupFunction) return false;
  let cursor: EsTreeNode | null | undefined = cleanupFunction.parent;
  while (cursor && !isNodeOfType(cursor, "ReturnStatement")) {
    if (isFunctionLike(cursor)) return false;
    cursor = cursor.parent ?? null;
  }
  if (!cursor) return false;
  let effectCallback: EsTreeNode | null | undefined = cursor.parent;
  while (effectCallback && !isFunctionLike(effectCallback)) {
    effectCallback = effectCallback.parent ?? null;
  }
  if (!effectCallback) return false;
  const effectCall = effectCallback.parent;
  if (
    !effectCall ||
    !isNodeOfType(effectCall, "CallExpression") ||
    !(effectCall.arguments ?? []).includes(effectCallback as never)
  ) {
    return false;
  }
  const effectName = getCalleeName(effectCall);
  if (!effectName || !/^use(?:Layout|Insertion)?Effect$/.test(effectName)) return false;
  let didRegister = false;
  walkAst(effectCallback, (child) => {
    if (didRegister) return false;
    if (child === cleanupFunction) return false;
    if (
      isNodeOfType(child, "CallExpression") &&
      isNodeOfType(child.callee, "MemberExpression") &&
      !child.callee.computed &&
      isNodeOfType(child.callee.property, "Identifier") &&
      (child.callee.property.name === "push" || child.callee.property.name === "add") &&
      rootIdentifierNode(stripParenExpression(child.callee.object as EsTreeNode))?.name ===
        rootIdentifierName
    ) {
      didRegister = true;
      return false;
    }
  });
  return didRegister;
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
// `.current` carve-out). Applies when the array is reached through a member
// access on the container, and to direct `splice` (registry add/remove
// maintenance, e.g. a timeout-id registry emptied on unmount) — a direct
// `stateArray.sort()` stays flagged.
const isSetterlessUseStateBinding = (binding: BindingInfo): boolean => {
  const declarator = nearestVariableDeclarator(binding.bindingIdentifier);
  if (!declarator || !isNodeOfType(declarator.id, "ArrayPattern")) return false;
  const boundElements = declarator.id.elements.filter(Boolean);
  if (boundElements.length !== 1) return false;
  if (!declarator.init) return false;
  return getCalleeName(stripParenExpression(declarator.init as EsTreeNode)) === "useState";
};

// Array-returning methods that always allocate a fresh array, so mutating
// their result never touches the source collection.
const FRESH_ARRAY_PRODUCING_METHODS = new Set([
  "filter",
  "map",
  "slice",
  "concat",
  "flat",
  "flatMap",
  "toSorted",
  "toReversed",
  "toSpliced",
]);

const isProvablyFreshOrAbsentValue = (expression: EsTreeNode): boolean => {
  const stripped = stripParenExpression(expression);
  if (isNodeOfType(stripped, "ArrayExpression")) return true;
  if (isNodeOfType(stripped, "Identifier") && stripped.name === "undefined") return true;
  if (isNodeOfType(stripped, "Literal") && stripped.value === null) return true;
  if (isNodeOfType(stripped, "ConditionalExpression")) {
    return (
      isProvablyFreshOrAbsentValue(stripped.consequent) &&
      isProvablyFreshOrAbsentValue(stripped.alternate)
    );
  }
  if (isNodeOfType(stripped, "LogicalExpression")) {
    return (
      isProvablyFreshOrAbsentValue(stripped.left) && isProvablyFreshOrAbsentValue(stripped.right)
    );
  }
  if (isNodeOfType(stripped, "CallExpression")) {
    const callee = stripped.callee;
    if (isNodeOfType(callee, "MemberExpression") && !callee.computed) {
      const method = callee.property;
      if (!isNodeOfType(method, "Identifier")) return false;
      if (FRESH_ARRAY_PRODUCING_METHODS.has(method.name)) return true;
      return (
        method.name === "from" &&
        isNodeOfType(callee.object, "Identifier") &&
        callee.object.name === "Array"
      );
    }
  }
  return false;
};

// `const rows = useMemo(() => source?.filter(...), deps)` — the memo result
// is a component-owned fresh copy on every return path (`.filter()`,
// `.slice()`, `[...]`, an array literal, or nothing at all), so an in-place
// sort touches no shared/cached data. Any return path yielding an identifier
// or member expression (e.g. `return payload ?? []`) can still alias the
// source, so the exemption is refused.
const isUseMemoReturningOnlyFreshArrays = (hookCall: EsTreeNode | null): boolean => {
  if (!hookCall || !isNodeOfType(hookCall, "CallExpression")) return false;
  if (getCalleeName(hookCall) !== "useMemo") return false;
  const factoryArgument = hookCall.arguments?.[0];
  if (!factoryArgument) return false;
  const factory = stripParenExpression(factoryArgument);
  if (!isFunctionLike(factory)) return false;
  const body = factory.body;
  if (!body) return false;
  if (!isNodeOfType(body, "BlockStatement")) return isProvablyFreshOrAbsentValue(body);
  let sawUnprovenReturn = false;
  let sawFreshReturn = false;
  walkAst(body, (child) => {
    if (child !== body && isFunctionLike(child)) return false;
    if (!isNodeOfType(child, "ReturnStatement")) return undefined;
    const returnedValue = child.argument;
    if (!returnedValue || isProvablyFreshOrAbsentValue(returnedValue)) {
      sawFreshReturn = true;
    } else {
      sawUnprovenReturn = true;
    }
    return undefined;
  });
  return sawFreshReturn && !sawUnprovenReturn;
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

// `events = events.filter(...)` before the flagged call rebinds the name to a
// fresh array, so the mutating call no longer touches the prop / hook result.
// The assignment must complete before the call starts, so `items = items.sort()`
// (which still mutates the shared array in place) stays flagged.
const hasRebindBeforeCall = (
  binding: BindingInfo,
  identifierName: string,
  callNode: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): boolean => {
  const symbol = context.scopes.symbolFor(binding.bindingIdentifier);
  if (!symbol || symbol.name !== identifierName) return false;
  return symbol.references.some((reference) => {
    if (reference.flag === "read") return false;
    const assignment = reference.identifier.parent;
    return Boolean(
      assignment &&
      isNodeOfType(assignment, "AssignmentExpression") &&
      assignment.operator === "=" &&
      assignment.left === reference.identifier &&
      isProvablyFreshOrAbsentValue(assignment.right as EsTreeNode) &&
      nodeDominatesNode(assignment, callNode, context),
    );
  });
};

const isProvableArrayContainerHookBinding = (binding: BindingInfo): boolean => {
  const initializer = binding.initializer ? stripParenExpression(binding.initializer) : null;
  const declaratorInitializer = declaratorInitFor(binding);
  let hookCall: EsTreeNode | null = null;
  if (initializer && isNodeOfType(initializer, "CallExpression")) {
    hookCall = initializer;
  } else if (declaratorInitializer) {
    const strippedDeclaratorInitializer = stripParenExpression(declaratorInitializer);
    if (isNodeOfType(strippedDeclaratorInitializer, "CallExpression")) {
      hookCall = strippedDeclaratorInitializer;
    }
  }
  if (!hookCall || !isNodeOfType(hookCall, "CallExpression")) return false;
  const hookName = getCalleeName(hookCall);
  return (
    hookName === "useContext" ||
    hookName === "useMemo" ||
    hookName === "useReducer" ||
    hookName === "useState" ||
    hookName === "useSyncExternalStore"
  );
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
  mutatingMethodName: string,
  reachesThroughMemberAccess: boolean,
  depth: number,
  context: RuleContext,
): SharedArraySource | null => {
  if (depth > ALIAS_RESOLUTION_DEPTH_LIMIT) return null;
  if (hasMutationSafeWord(rootIdentifier.name)) return null;
  const binding = findVariableInitializer(rootIdentifier, rootIdentifier.name);
  if (!binding) return null;
  if (hasRebindBeforeCall(binding, rootIdentifier.name, callNode, context)) return null;
  if (!reachesThroughMemberAccess && isBoundThroughRestElement(binding)) return null;
  if (isDerivedFromHookCall(binding)) {
    if (!isProvableArrayContainerHookBinding(binding)) return null;
    if (
      isSetterlessUseStateBinding(binding) &&
      (reachesThroughMemberAccess || mutatingMethodName === "splice")
    ) {
      return null;
    }
    const initializerCall = binding.initializer ? stripParenExpression(binding.initializer) : null;
    const declaratorInit = declaratorInitFor(binding);
    if (
      isMutableStoreHookCall(initializerCall) ||
      isMutableStoreHookCall(declaratorInit ? stripParenExpression(declaratorInit) : null)
    ) {
      return null;
    }
    if (!reachesThroughMemberAccess && isUseMemoReturningOnlyFreshArrays(initializerCall)) {
      return null;
    }
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
    mutatingMethodName,
    reachesThroughMemberAccess || aliasSource.isMemberAccess,
    depth + 1,
    context,
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
    "`sort`, `reverse`, and `splice` mutate in place, so calling them on a prop or hook result corrupts shared state. Use the immutable `toSorted`/`toReversed`/`toSpliced`, or copy the array first (`[...array].sort()`) when targeting pre-ES2023 runtimes.",
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
      if (NON_ARRAY_RECEIVER_NAME_PATTERN.test(rootIdentifier.name)) return;
      if (scopeShowsPlaybackSiblingCall(rootIdentifier, context)) return;
      if (
        callee.property.name === "splice" &&
        isRegistryCleanupMutation(node as EsTreeNode, rootIdentifier.name)
      ) {
        return;
      }
      const receiverIsMemberAccess = isNodeOfType(receiver, "MemberExpression");
      const source = resolveSharedArraySource(
        rootIdentifier,
        node,
        callee.property.name,
        receiverIsMemberAccess,
        0,
        context,
      );
      if (!source) return;
      context.report({ node, message: messageFor(source) });
    },
  }),
});
