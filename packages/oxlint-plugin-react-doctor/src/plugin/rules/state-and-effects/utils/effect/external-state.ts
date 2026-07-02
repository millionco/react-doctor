import type { Reference } from "eslint-scope";
import type { EsTreeNode } from "../../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../../utils/es-tree-node-of-type.js";
import { isFunctionLike } from "../../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../../utils/is-node-of-type.js";
import type { ProgramAnalysis } from "./get-program-analysis.js";

// Callees that take a function and run it LATER, off the React render /
// event-handler path: timers, the microtask queue, DOM/event-target
// listeners, observers, promise continuations, and store subscriptions.
// A `setState` reached only through one of these fires from an imperative
// browser event, not from a React event handler — so the "you might not
// need an effect / move it to the handler" advice cannot apply.
const DEFERRING_CALLEE_NAMES: ReadonlySet<string> = new Set([
  "setTimeout",
  "setInterval",
  "setImmediate",
  "requestAnimationFrame",
  "requestIdleCallback",
  "queueMicrotask",
  "addEventListener",
  "addListener",
  "subscribe",
  "observe",
  "watch",
  "watchPosition",
  "then",
  "catch",
  "finally",
  "on",
  "once",
]);

const getCalleeName = (callee: EsTreeNode | null | undefined): string | null => {
  if (!callee) return null;
  if (isNodeOfType(callee, "Identifier")) return callee.name;
  if (isNodeOfType(callee, "MemberExpression") && isNodeOfType(callee.property, "Identifier")) {
    return callee.property.name;
  }
  return null;
};

const parentOf = (node: EsTreeNode): EsTreeNode | null =>
  (node as unknown as { parent?: EsTreeNode | null }).parent ?? null;

const argumentsInclude = (
  args: ReadonlyArray<unknown> | null | undefined,
  target: EsTreeNode,
): boolean => (args ?? []).some((argument) => (argument as unknown) === (target as unknown));

// Is `expression` (a function value, or a bare identifier referencing one)
// in a position that runs it LATER, off the synchronous path? Covers the
// argument slot of a deferring call (`addEventListener('x', expr)`,
// `setTimeout(expr)`), an observer / promise constructor, and assignment to
// an `on*` event-handler property (`el.onmessage = expr`). An `onX:` key in a
// plain options object is deliberately NOT deferred — config-object callbacks
// (`{ onDestroyed: handler }`) routinely fire on the synchronous React path.
const isDeferredCallbackPosition = (expression: EsTreeNode): boolean => {
  const parent = parentOf(expression);
  if (!parent) return false;

  if (isNodeOfType(parent, "CallExpression") && argumentsInclude(parent.arguments, expression)) {
    const name = getCalleeName(parent.callee as EsTreeNode);
    if (name && DEFERRING_CALLEE_NAMES.has(name)) return true;
  }
  if (isNodeOfType(parent, "NewExpression") && argumentsInclude(parent.arguments, expression)) {
    const name = getCalleeName(parent.callee as EsTreeNode);
    if (name && (name.endsWith("Observer") || name === "Promise")) return true;
  }
  if (
    isNodeOfType(parent, "AssignmentExpression") &&
    parent.right === expression &&
    isNodeOfType(parent.left, "MemberExpression") &&
    isNodeOfType(parent.left.property, "Identifier") &&
    parent.left.property.name.startsWith("on")
  ) {
    return true;
  }
  return false;
};

// The binding a function is assigned to, unwrapping memoizing wrappers:
// `const h = () => …` → `h`, and `const h = useCallback(() => …, [])` → `h`.
const getHandlerDeclarator = (fn: EsTreeNode): EsTreeNodeOfType<"VariableDeclarator"> | null => {
  let current = fn;
  let parent = parentOf(current);
  while (
    parent &&
    isNodeOfType(parent, "CallExpression") &&
    argumentsInclude(parent.arguments, current)
  ) {
    current = parent;
    parent = parentOf(current);
  }
  if (
    parent &&
    isNodeOfType(parent, "VariableDeclarator") &&
    isNodeOfType(parent.id, "Identifier")
  ) {
    return parent;
  }
  return null;
};

// A named handler — `const onResize = () => setX(); addEventListener('resize',
// onResize)` (or a `useCallback`-wrapped one) — is registered by reference, so
// the function's own parent is the declarator, not the deferring call. Resolve
// the binding and check whether ANY of its references sits in a
// deferred-callback position.
const isNamedHandlerUsedAsDeferredCallback = (
  analysis: ProgramAnalysis,
  fn: EsTreeNode,
): boolean => {
  const declarator = getHandlerDeclarator(fn);
  if (!declarator || !isNodeOfType(declarator.id, "Identifier")) return false;
  const name = declarator.id.name;
  for (const scope of analysis.scopeManager.scopes) {
    const variable = scope.variables.find(
      (candidate) =>
        candidate.name === name &&
        candidate.defs.some((def) => (def.node as unknown as EsTreeNode) === declarator),
    );
    if (!variable) continue;
    return variable.references.some((reference) =>
      isDeferredCallbackPosition(reference.identifier as unknown as EsTreeNode),
    );
  }
  return false;
};

// Is `fn` itself a "deferred" callback — handed to a deferring API inline, or
// a named handler registered with one? These never run synchronously during
// render or a React event. An `async` function is deliberately NOT deferred
// by itself: an async onClick handler is still a React event handler, so the
// "fold the work into the handler" advice fully applies.
const isDeferredCallbackFunction = (analysis: ProgramAnalysis, fn: EsTreeNode): boolean => {
  if (isDeferredCallbackPosition(fn)) return true;
  return isNamedHandlerUsedAsDeferredCallback(analysis, fn);
};

// Walk up from `node` to `boundary`; true if any enclosing function is a
// deferred callback.
const isInsideDeferredCallback = (
  analysis: ProgramAnalysis,
  node: EsTreeNode,
  boundary: EsTreeNode | null,
): boolean => {
  let current: EsTreeNode | null = parentOf(node);
  while (current && current !== boundary) {
    if (isFunctionLike(current) && isDeferredCallbackFunction(analysis, current)) return true;
    current = parentOf(current);
  }
  return false;
};

const findUseStateDeclarator = (ref: Reference): EsTreeNode | null => {
  for (const def of ref.resolved?.defs ?? []) {
    const node = def.node as unknown as EsTreeNode;
    if (!isNodeOfType(node, "VariableDeclarator")) continue;
    if (!isNodeOfType(node.init, "CallExpression")) continue;
    if (!isNodeOfType(node.id, "ArrayPattern")) continue;
    return node;
  }
  return null;
};

// The answer depends only on the state's declaration, so cache it per
// declarator — the effect-family rules query the same state from many refs.
const declaratorToExternallyDriven = new WeakMap<EsTreeNode, boolean>();

// A `useState` value is "externally driven" when its setter is called
// EXCLUSIVELY from inside deferred callbacks (timers / listeners / observers /
// promises / subscriptions). Effects that merely REACT to such state
// (`useEffect(() => notify(state), [state])`) are not the
// "you-might-not-need-an-effect" anti-pattern: there is no React event
// handler to fold the work into, because the state changes only in response
// to an imperative browser event. Mixed origin — the same setter also called
// from a plain handler or render path — keeps the state reportable: the
// handler-driven updates DO have a handler to fold into. The effect-family
// rules consult this to suppress the exclusively-external false positives.
export const isExternallyDrivenState = (analysis: ProgramAnalysis, ref: Reference): boolean => {
  const declarator = findUseStateDeclarator(ref);
  if (!declarator || !isNodeOfType(declarator, "VariableDeclarator")) return false;
  if (!isNodeOfType(declarator.id, "ArrayPattern")) return false;

  const cached = declaratorToExternallyDriven.get(declarator);
  if (cached !== undefined) return cached;
  const result = computeExternallyDriven(analysis, declarator);
  declaratorToExternallyDriven.set(declarator, result);
  return result;
};

const computeExternallyDriven = (
  analysis: ProgramAnalysis,
  declarator: EsTreeNodeOfType<"VariableDeclarator">,
): boolean => {
  if (!isNodeOfType(declarator.id, "ArrayPattern")) return false;
  const setterElement = declarator.id.elements?.[1];
  if (!setterElement || !isNodeOfType(setterElement, "Identifier")) return false;
  const setterName = setterElement.name;

  // Resolve the setter binding by the declarator it is defined at, not via
  // `ref.resolved.scope` — synthetic upstream refs don't always carry the
  // component scope, but the setter is always declared at the same
  // `useState` destructure as the state.
  let setterVariable: (typeof analysis.scopeManager.scopes)[number]["variables"][number] | null =
    null;
  for (const scope of analysis.scopeManager.scopes) {
    const match = scope.variables.find(
      (variable) =>
        variable.name === setterName &&
        variable.defs.some((def) => (def.node as unknown as EsTreeNode) === declarator),
    );
    if (match) {
      setterVariable = match;
      break;
    }
  }
  if (!setterVariable) return false;

  let hasDeferredCallSite = false;
  for (const setterReference of setterVariable.references) {
    const identifier = setterReference.identifier as unknown as EsTreeNode;
    const parent = parentOf(identifier);
    if (!parent || !isNodeOfType(parent, "CallExpression")) continue;
    if (parent.callee !== (identifier as unknown)) continue;
    if (!isInsideDeferredCallback(analysis, parent, declarator)) return false;
    hasDeferredCallSite = true;
  }
  return hasDeferredCallSite;
};
