import type { Reference, Variable } from "eslint-scope";
import type { EsTreeNode } from "../../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../../utils/es-tree-node-of-type.js";
import { getCalleeName } from "../../../../utils/get-callee-name.js";
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

const parentOf = (node: EsTreeNode): EsTreeNode | null => node.parent ?? null;

const argumentsInclude = (
  args: ReadonlyArray<unknown> | null | undefined,
  target: EsTreeNode,
): boolean => (args ?? []).some((argument) => argument === target);

// Is `expression` (a function value, or a bare identifier referencing one)
// in a position that runs it LATER, off the synchronous path? Covers the
// argument slot of a deferring call (`addEventListener('x', expr)`,
// `setTimeout(expr)`), an observer / promise constructor, and assignment to
// an `on*` event-handler property (`el.onmessage = expr`). A bare
// `{ onX: expr }` object property is NOT deferred: plain options objects
// (`{ onDestroyed: handler }`) use the same spelling as listener maps, and
// assuming registration there silences real state-machine smells.
const isDeferredCallbackPosition = (expression: EsTreeNode): boolean => {
  const parent = parentOf(expression);
  if (!parent) return false;

  if (isNodeOfType(parent, "CallExpression") && argumentsInclude(parent.arguments, expression)) {
    const name = getCalleeName(parent);
    if (name && DEFERRING_CALLEE_NAMES.has(name)) return true;
  }
  if (isNodeOfType(parent, "NewExpression") && argumentsInclude(parent.arguments, expression)) {
    const name = getCalleeName(parent);
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
// render or a React event. `async` alone does NOT qualify: an async onClick
// handler is still a React event handler, so state it sets is
// handler-driven, not externally driven.
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
// EXCLUSIVELY from inside deferred callbacks (timers / listeners /
// observers / promise continuations / subscriptions). Effects that merely
// REACT to such state (`useEffect(() => notify(state), [state])`) are not
// the "you-might-not-need-an-effect" anti-pattern: there is no React event
// handler to fold the work into, because the state only ever changes in
// response to an imperative browser event. One deferred call site is NOT
// enough — a setter that is also called from a render-path function (an
// event handler, another effect) proves a handler exists to fold into, so
// the state stays eligible for the effect-family rules.
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
  let setterVariable: Variable | null = null;
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

  let hasDeferredSetterUse = false;
  for (const setterReference of setterVariable.references) {
    if (setterReference.init) continue;
    const identifier = setterReference.identifier as unknown as EsTreeNode;
    const parent = parentOf(identifier);
    const isSetterCallSite =
      parent !== null && isNodeOfType(parent, "CallExpression") && parent.callee === identifier;
    const enclosingNode = isSetterCallSite && parent ? parent : identifier;
    const isDeferredUse =
      (!isSetterCallSite && isDeferredCallbackPosition(identifier)) ||
      isInsideDeferredCallback(analysis, enclosingNode, declarator);
    if (isDeferredUse) {
      hasDeferredSetterUse = true;
    } else {
      return false;
    }
  }
  return hasDeferredSetterUse;
};
