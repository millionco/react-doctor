import type { Reference } from "eslint-scope";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isAstDescendant } from "../../utils/is-ast-descendant.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import {
  findDownstreamNodes,
  getDownstreamRefs,
  getRef,
  isInsideCallbackArgumentOf,
} from "./utils/effect/ast.js";
import { isExternallyDrivenState } from "./utils/effect/external-state.js";
import type { ProgramAnalysis } from "./utils/effect/get-program-analysis.js";
import { getProgramAnalysis } from "./utils/effect/get-program-analysis.js";
import {
  getEffectFn,
  getEffectFnRefs,
  hasCleanup,
  isCustomHookParameter,
  isProp,
  isState,
  isStateSetter,
  isUseEffect,
  isWholePropsObjectReference,
} from "./utils/effect/react.js";

const SETTER_NAME_PATTERN = /^set[A-Z]/;
// A `useReducer` dispatch preamble (`focusDispatch({ type: 'X' }); return;`)
// is the same state-hop-then-exit shape as a setter preamble — dispatch IS
// the reducer's setter — so early-exit consequents built from dispatches
// are state sync, not faked event handlers.
const DISPATCH_NAME_PATTERN = /^dispatch$|Dispatch$/;
const HOOK_NAME_PATTERN = /^use[A-Z0-9]/;

const isSetterLikeName = (name: string): boolean =>
  SETTER_NAME_PATTERN.test(name) || DISPATCH_NAME_PATTERN.test(name);

// True for the preamble forms allowed inside a pure-early-exit
// consequent block: `setX(value)`, `setX?.(value)`, `props.onChange(value)`,
// or `xxxRef.current = value` (ref bookkeeping isn't event-handler-like).
const isSetterCallExpressionStatement = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "ExpressionStatement")) return false;
  let expression = node.expression as EsTreeNode | null;
  if (expression && isNodeOfType(expression, "ChainExpression")) {
    expression = expression.expression as EsTreeNode;
  }
  if (!expression) return false;
  if (isNodeOfType(expression, "CallExpression")) {
    const callee = expression.callee;
    if (isNodeOfType(callee, "Identifier")) {
      return isSetterLikeName(callee.name);
    }
    if (
      isNodeOfType(callee, "MemberExpression") &&
      isNodeOfType(callee.property, "Identifier") &&
      isSetterLikeName(callee.property.name)
    ) {
      return true;
    }
    return false;
  }
  if (isNodeOfType(expression, "AssignmentExpression")) {
    const left = expression.left;
    if (
      isNodeOfType(left, "MemberExpression") &&
      !left.computed &&
      isNodeOfType(left.property, "Identifier") &&
      left.property.name === "current" &&
      isNodeOfType(left.object, "Identifier")
    ) {
      return true;
    }
  }
  return false;
};

// `xxxRef.current` anywhere in the IF test marks the effect as a
// one-shot hydration / lazy-mount / scroll-restore guard, not an
// event-handler antipattern.
const REF_GUARD_SCAN_BUDGET = 50;

const containsRefGuard = (testNode: EsTreeNode): boolean => {
  const stack: EsTreeNode[] = [testNode];
  let budget = REF_GUARD_SCAN_BUDGET;
  while (stack.length > 0 && budget-- > 0) {
    const node = stack.pop()!;
    if (
      isNodeOfType(node, "MemberExpression") &&
      !node.computed &&
      isNodeOfType(node.property, "Identifier") &&
      node.property.name === "current" &&
      isNodeOfType(node.object, "Identifier")
    ) {
      const name = node.object.name;
      if (name === "ref" || name.endsWith("Ref") || name.endsWith("ref")) return true;
    }
    if (isNodeOfType(node, "LogicalExpression") || isNodeOfType(node, "BinaryExpression")) {
      stack.push(node.left as EsTreeNode, node.right as EsTreeNode);
    } else if (isNodeOfType(node, "UnaryExpression")) {
      stack.push(node.argument as EsTreeNode);
    } else if (isNodeOfType(node, "ConditionalExpression")) {
      stack.push(
        node.test as EsTreeNode,
        node.consequent as EsTreeNode,
        node.alternate as EsTreeNode,
      );
    } else if (isNodeOfType(node, "MemberExpression")) {
      stack.push(node.object as EsTreeNode);
    } else if (isNodeOfType(node, "ChainExpression")) {
      stack.push(node.expression as EsTreeNode);
    }
  }
  return false;
};

// A guard comparing a PREVIOUS-value holder (a `useRef` `.current` read or
// a `usePrevious`-style opaque-hook result) against a current value is
// transition detection — "did the prop/state change since last render" —
// which no local event handler can observe (the parent or an external
// source drives the change). Comparisons against literals stay reportable:
// `state.status === 'SUBMIT'` is a plain state watch, not a prev/current
// diff. The scan mirrors `containsRefGuard`'s traversal and deliberately
// does NOT descend into call arguments, so comparisons inside `.some(...)`
// callbacks (appflowy) keep firing.
const COMPARISON_OPERATORS: ReadonlySet<string> = new Set([
  "==",
  "===",
  "!=",
  "!==",
  "<",
  "<=",
  ">",
  ">=",
]);

const isLiteralLikeNode = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "Literal") ||
  isNodeOfType(node, "TemplateLiteral") ||
  (isNodeOfType(node, "UnaryExpression") && isNodeOfType(node.argument, "Literal"));

const isPreviousValueComparisonSide = (analysis: ProgramAnalysis, side: EsTreeNode): boolean => {
  let current: EsTreeNode = side;
  for (;;) {
    if (isNodeOfType(current, "ChainExpression")) {
      current = current.expression as EsTreeNode;
    } else if (isNodeOfType(current, "TSNonNullExpression")) {
      current = current.expression as EsTreeNode;
    } else if (isNodeOfType(current, "MemberExpression")) {
      if (
        !current.computed &&
        isNodeOfType(current.property, "Identifier") &&
        current.property.name === "current" &&
        isNodeOfType(current.object, "Identifier")
      ) {
        const objectRef = getRef(analysis, current.object);
        if (objectRef && isUseRefBinding(objectRef)) return true;
      }
      current = current.object as EsTreeNode;
    } else {
      break;
    }
  }
  if (!isNodeOfType(current, "Identifier")) return false;
  const baseRef = getRef(analysis, current);
  return Boolean(baseRef && isOpaqueHookResultBinding(baseRef));
};

const containsPreviousValueComparison = (
  analysis: ProgramAnalysis,
  testNode: EsTreeNode,
): boolean => {
  const stack: EsTreeNode[] = [testNode];
  let budget = REF_GUARD_SCAN_BUDGET;
  while (stack.length > 0 && budget-- > 0) {
    const node = stack.pop()!;
    if (isNodeOfType(node, "BinaryExpression")) {
      if (COMPARISON_OPERATORS.has(node.operator)) {
        const left = node.left as EsTreeNode;
        const right = node.right as EsTreeNode;
        if (isPreviousValueComparisonSide(analysis, left) && !isLiteralLikeNode(right)) {
          return true;
        }
        if (isPreviousValueComparisonSide(analysis, right) && !isLiteralLikeNode(left)) {
          return true;
        }
      }
      stack.push(node.left as EsTreeNode, node.right as EsTreeNode);
    } else if (isNodeOfType(node, "LogicalExpression")) {
      stack.push(node.left as EsTreeNode, node.right as EsTreeNode);
    } else if (isNodeOfType(node, "UnaryExpression")) {
      stack.push(node.argument as EsTreeNode);
    } else if (isNodeOfType(node, "ConditionalExpression")) {
      stack.push(
        node.test as EsTreeNode,
        node.consequent as EsTreeNode,
        node.alternate as EsTreeNode,
      );
    } else if (isNodeOfType(node, "ChainExpression")) {
      stack.push(node.expression as EsTreeNode);
    }
  }
  return false;
};

// Values returned by React's own value-producing hooks are transparent
// derivations of their arguments (`useMemo(() => f(a), [a])` computes from
// `a`; `useState(a)` seeds from `a`), so the upstream walk may descend into
// the call. A CUSTOM hook (`useControllable(...)`, `useFieldSelector(...)`)
// is an opaque state-management abstraction — its return value's relation
// to its arguments is unknown, and reporting every prop passed to it as
// "faking an event handler" is the dominant false-positive factory.
const TRANSPARENT_HOOK_NAMES: ReadonlySet<string> = new Set([
  "useMemo",
  "useCallback",
  "useState",
  "useRef",
  "useDeferredValue",
]);

const getHookCalleeName = (node: EsTreeNode): string | null => {
  if (!isNodeOfType(node, "CallExpression")) return null;
  const callee = node.callee;
  if (isNodeOfType(callee, "Identifier")) return callee.name;
  if (isNodeOfType(callee, "MemberExpression") && isNodeOfType(callee.property, "Identifier")) {
    return callee.property.name;
  }
  return null;
};

const isOpaqueCustomHookInit = (init: EsTreeNode): boolean => {
  const calleeName = getHookCalleeName(init);
  return (
    calleeName !== null &&
    HOOK_NAME_PATTERN.test(calleeName) &&
    !TRANSPARENT_HOOK_NAMES.has(calleeName)
  );
};

const getDeclaratorInit = (ref: Reference): EsTreeNode | null => {
  for (const def of ref.resolved?.defs ?? []) {
    const node = def.node as unknown as EsTreeNode;
    if (isNodeOfType(node, "VariableDeclarator") && node.init) return node.init as EsTreeNode;
  }
  return null;
};

const isOpaqueHookResultBinding = (ref: Reference): boolean => {
  const init = getDeclaratorInit(ref);
  return Boolean(init && isOpaqueCustomHookInit(init));
};

const isUseRefBinding = (ref: Reference): boolean => {
  const init = getDeclaratorInit(ref);
  return Boolean(init && getHookCalleeName(init) === "useRef");
};

const REACT_BUILTIN_HOOK_NAMES: ReadonlySet<string> = new Set([
  "useState",
  "useReducer",
  "useContext",
  "useMemo",
  "useCallback",
  "useRef",
  "useDeferredValue",
  "useTransition",
  "useSyncExternalStore",
  "useImperativeHandle",
  "useLayoutEffect",
  "useEffect",
  "useInsertionEffect",
  "useId",
  "useOptimistic",
  "useActionState",
  "useDebugValue",
]);

const isCustomHookReturnedBinding = (ref: Reference): boolean => {
  const init = getDeclaratorInit(ref);
  if (!init) return false;
  const calleeName = getHookCalleeName(init);
  return (
    calleeName !== null &&
    HOOK_NAME_PATTERN.test(calleeName) &&
    !REACT_BUILTIN_HOOK_NAMES.has(calleeName)
  );
};

// The guard-seed expansion: like `getUpstreamRefs`, but stops at opaque
// custom-hook initializers instead of treating every hook argument as an
// upstream data source of the tested value.
const collectGuardUpstreamRefs = (
  analysis: ProgramAnalysis,
  ref: Reference,
  refs: Reference[],
  visited: Set<Reference>,
): void => {
  if (visited.has(ref)) return;
  visited.add(ref);
  refs.push(ref);
  for (const def of ref.resolved?.defs ?? []) {
    if (def.type === "ImportBinding" || def.type === "Parameter") continue;
    const defNode = def.node as unknown as Record<string, unknown>;
    const next = (defNode.init ?? defNode.body) as EsTreeNode | undefined;
    if (!next) continue;
    if (isOpaqueCustomHookInit(next)) continue;
    for (const innerRef of getDownstreamRefs(analysis, next)) {
      if (isInsideCallbackArgumentOf(innerRef.identifier as unknown as EsTreeNode, next)) {
        continue;
      }
      collectGuardUpstreamRefs(analysis, innerRef, refs, visited);
    }
  }
};

const getGuardUpstreamRefs = (analysis: ProgramAnalysis, ref: Reference): Reference[] => {
  const refs: Reference[] = [];
  collectGuardUpstreamRefs(analysis, ref, refs, new Set());
  return refs;
};

// "Side-effect-free exit": `return;`, `return null;`, `return X;` where
// X is a simple identifier/literal. `return fn()` is NOT — the call IS
// the work, just disguised.
const isSideEffectFreeExit = (statement: EsTreeNode): boolean => {
  if (isNodeOfType(statement, "ContinueStatement")) return true;
  if (isNodeOfType(statement, "BreakStatement")) return true;
  if (!isNodeOfType(statement, "ReturnStatement")) return false;
  const argument = statement.argument;
  if (!argument) return true;
  if (isNodeOfType(argument, "Literal")) return true;
  if (isNodeOfType(argument, "Identifier")) return true;
  if (isNodeOfType(argument, "UnaryExpression") && argument.operator === "void") return true;
  return false;
};

// The controlled/uncontrolled mirror — `if (valueProp !== undefined)
// setValue(valueProp)` — is state SYNCHRONISATION owned by the dedicated
// state-sync rules, not a faked event handler. The exemption is deliberately
// exact: every consequent statement must be a `setX(prop)` call whose callee
// resolves to a useState setter and whose sole argument is a prop tested by
// the guard itself. Anything looser (`setResults(items.slice(...))`,
// `setTimeout(onShow, 0)`, `el.setAttribute(...)`) is real event work and
// must keep firing.
const getConsequentStatements = (consequent: EsTreeNode): ReadonlyArray<EsTreeNode> => {
  if (isNodeOfType(consequent, "BlockStatement")) {
    return (consequent.body ?? []) as unknown as ReadonlyArray<EsTreeNode>;
  }
  return [consequent];
};

const isControlledPropMirrorStatement = (
  analysis: ProgramAnalysis,
  statement: EsTreeNode,
  testedPropBindings: ReadonlySet<unknown>,
): boolean => {
  if (!isNodeOfType(statement, "ExpressionStatement")) return false;
  let expression = statement.expression as EsTreeNode | null;
  if (expression && isNodeOfType(expression, "ChainExpression")) {
    expression = expression.expression as EsTreeNode;
  }
  if (!expression || !isNodeOfType(expression, "CallExpression")) return false;
  const callee = expression.callee;
  if (!isNodeOfType(callee, "Identifier")) return false;
  const calleeRef = getRef(analysis, callee);
  if (!calleeRef || !isStateSetter(analysis, calleeRef)) return false;
  const callArguments = expression.arguments ?? [];
  if (callArguments.length !== 1) return false;
  const argument = callArguments[0];
  if (!isNodeOfType(argument, "Identifier")) return false;
  const argumentRef = getRef(analysis, argument);
  if (!argumentRef?.resolved || !isProp(analysis, argumentRef)) return false;
  return testedPropBindings.has(argumentRef.resolved);
};

const isControlledPropMirrorConsequent = (
  analysis: ProgramAnalysis,
  ifNode: EsTreeNodeOfType<"IfStatement">,
): boolean => {
  const statements = getConsequentStatements(ifNode.consequent as EsTreeNode);
  if (statements.length === 0) return false;
  const testRefs = getDownstreamRefs(analysis, ifNode.test as EsTreeNode);
  // A pure mirror guard tests only the mirrored prop. A guard that ALSO
  // reads other state (`!debouncing.current && searchValue === '' &&
  // search !== ''`) is a reset state machine — real event work, not sync.
  if (testRefs.some((ref) => isState(analysis, ref))) return false;
  const testedPropBindings = new Set<unknown>(
    testRefs
      .filter((ref) => isProp(analysis, ref))
      .map((ref) => (ref as unknown as { resolved?: unknown }).resolved)
      .filter(Boolean),
  );
  if (testedPropBindings.size === 0) return false;
  return statements.every((statement) =>
    isControlledPropMirrorStatement(analysis, statement, testedPropBindings),
  );
};

const isPureEarlyExitConsequent = (consequent: EsTreeNode): boolean => {
  if (
    isNodeOfType(consequent, "ReturnStatement") ||
    isNodeOfType(consequent, "ContinueStatement") ||
    isNodeOfType(consequent, "BreakStatement")
  ) {
    return isSideEffectFreeExit(consequent);
  }
  if (isNodeOfType(consequent, "BlockStatement")) {
    const body = consequent.body ?? [];
    // An empty `if (cond) {}` is NOT a pure early-exit guard — it's
    // either dead code or a guarded-no-op around following work. Either
    // way it doesn't justify skipping the rule.
    if (body.length === 0) return false;
    const last = body[body.length - 1] as EsTreeNode;
    if (!isSideEffectFreeExit(last)) return false;
    // Allow any number of setter-only preamble statements:
    //   if (!enabled) { setLocal(initial); setLoading(false); return; }
    for (let i = 0; i < body.length - 1; i++) {
      if (!isSetterCallExpressionStatement(body[i] as EsTreeNode)) return false;
    }
    return true;
  }
  return false;
};

const isEffectLocalBinding = (ref: Reference, effectFn: EsTreeNode): boolean =>
  Boolean(
    ref.resolved &&
    ref.resolved.defs.length > 0 &&
    ref.resolved.defs.every((def) => isAstDescendant(def.node as unknown as EsTreeNode, effectFn)),
  );

// A consequent that only declares or reassigns effect-LOCAL bindings
// (`if (initialValue) { payload = {...} }`, `if (matches(path, cmd))
// lastMatching = cmd`) selects a value for work that happens
// unconditionally elsewhere in the effect. The guard is pure computation,
// not "when X becomes truthy, do the side effect".
const isEffectLocalWriteStatement = (
  analysis: ProgramAnalysis,
  statement: EsTreeNode,
  effectFn: EsTreeNode,
): boolean => {
  if (isSideEffectFreeExit(statement)) return true;
  if (isNodeOfType(statement, "VariableDeclaration")) return true;
  if (!isNodeOfType(statement, "ExpressionStatement")) return false;
  const expression = statement.expression as EsTreeNode;
  if (!isNodeOfType(expression, "AssignmentExpression")) return false;
  const left = expression.left as EsTreeNode;
  if (!isNodeOfType(left, "Identifier")) return false;
  const leftRef = getRef(analysis, left);
  return Boolean(leftRef && isEffectLocalBinding(leftRef, effectFn));
};

const isLocalComputationConsequent = (
  analysis: ProgramAnalysis,
  ifNode: EsTreeNodeOfType<"IfStatement">,
  effectFn: EsTreeNode,
): boolean => {
  const statements = getConsequentStatements(ifNode.consequent as EsTreeNode);
  if (statements.length === 0) return false;
  return statements.every((statement) =>
    isEffectLocalWriteStatement(analysis, statement, effectFn),
  );
};

// A test whose every reference resolves to a binding declared INSIDE the
// effect (`const idx = routes.findIndex(...); if (idx >= 0) setCursor(idx)`)
// is internal control flow over a value computed on every run — the effect
// is not watching state through the guard, so the documented shape ("test
// reads state or a prop") does not apply. A test mixing locals with
// component-level state (`currPagerHeight !== pagerHeight`) still fires.
const isEffectLocalOnlyTest = (
  analysis: ProgramAnalysis,
  ifNode: EsTreeNodeOfType<"IfStatement">,
  effectFn: EsTreeNode,
): boolean => {
  const testRefs = getDownstreamRefs(analysis, ifNode.test as EsTreeNode);
  if (testRefs.length === 0) return false;
  return testRefs.every((ref) => isEffectLocalBinding(ref, effectFn));
};

// `if (leavesOnly) goToNearestLeaf()` where `goToNearestLeaf` is a
// deps-listed useCallback: the effect re-runs on the callback's closure
// (state, other callbacks), so the guarded call is invariant enforcement
// across many trigger paths — no single event handler can host it. The
// exemption is deliberately exact: one statement, zero arguments, callee
// declared via useCallback AND named in the effect's own deps array.
const isDepsListedCallbackInvocationConsequent = (
  analysis: ProgramAnalysis,
  ifNode: EsTreeNodeOfType<"IfStatement">,
  effectNode: EsTreeNodeOfType<"CallExpression">,
): boolean => {
  const statements = getConsequentStatements(ifNode.consequent as EsTreeNode);
  if (statements.length !== 1) return false;
  const statement = statements[0];
  if (!isNodeOfType(statement, "ExpressionStatement")) return false;
  let expression = statement.expression as EsTreeNode;
  if (isNodeOfType(expression, "ChainExpression")) {
    expression = expression.expression as EsTreeNode;
  }
  if (!isNodeOfType(expression, "CallExpression")) return false;
  if ((expression.arguments ?? []).length !== 0) return false;
  const callee = expression.callee;
  if (!isNodeOfType(callee, "Identifier")) return false;
  const calleeRef = getRef(analysis, callee);
  if (!calleeRef) return false;
  const init = getDeclaratorInit(calleeRef);
  if (!init || getHookCalleeName(init) !== "useCallback") return false;
  const deps = effectNode.arguments?.[1];
  if (!deps || !isNodeOfType(deps, "ArrayExpression")) return false;
  return (deps.elements ?? []).some(
    (element) => isNodeOfType(element, "Identifier") && element.name === callee.name,
  );
};

// A guarded consequent that ONLY drives an imperative interface — DOM nodes
// held in refs (`inputRef.current.focus()`), the window/document globals
// (`window.scrollTo(0, 0)`), a service instance returned by a custom hook
// (`router.push(...)`, `messages.addInfo(...)`), or a null-guard-tested
// external instance (`if (cy && ...) cy.zoom(zoom)`) — is post-render
// synchronization with an external system, not a faked event handler: it
// sets no state and calls no parent callback, so the "costs an extra
// render" claim does not hold and the work often CANNOT move into a
// handler (it must run after the DOM updates).
const IMPERATIVE_ROOT_GLOBAL_NAMES: ReadonlySet<string> = new Set([
  "window",
  "document",
  "globalThis",
]);
const PARENT_CALLBACK_NAME_PATTERN = /^on[A-Z]/;

// Iterating a tested collection (`items.forEach(...)`) is real work on
// data, not a method call driving an external instance — keep firing.
const DATA_ITERATION_METHOD_NAMES: ReadonlySet<string> = new Set([
  "forEach",
  "map",
  "filter",
  "reduce",
  "flatMap",
  "find",
  "some",
  "every",
  "push",
  "pop",
  "shift",
  "unshift",
  "splice",
  "sort",
  "reverse",
  "concat",
]);

interface ImperativeTargetChain {
  baseIdentifier: EsTreeNodeOfType<"Identifier"> | null;
  passesThroughRefCurrent: boolean;
  memberDepth: number;
}

const getImperativeTargetChain = (target: EsTreeNode): ImperativeTargetChain => {
  let current: EsTreeNode = target;
  let passesThroughRefCurrent = false;
  let memberDepth = 0;
  for (;;) {
    if (isNodeOfType(current, "ChainExpression")) {
      current = current.expression as EsTreeNode;
    } else if (isNodeOfType(current, "TSNonNullExpression")) {
      current = current.expression as EsTreeNode;
    } else if (isNodeOfType(current, "MemberExpression")) {
      if (
        !current.computed &&
        isNodeOfType(current.property, "Identifier") &&
        current.property.name === "current"
      ) {
        passesThroughRefCurrent = true;
      }
      memberDepth += 1;
      current = current.object as EsTreeNode;
    } else if (isNodeOfType(current, "CallExpression")) {
      current = current.callee as EsTreeNode;
    } else {
      break;
    }
  }
  return {
    baseIdentifier: isNodeOfType(current, "Identifier") ? current : null,
    passesThroughRefCurrent,
    memberDepth,
  };
};

const getInvokedMemberName = (callee: EsTreeNode): string | null => {
  let current: EsTreeNode = callee;
  if (isNodeOfType(current, "ChainExpression")) current = current.expression as EsTreeNode;
  if (isNodeOfType(current, "MemberExpression") && isNodeOfType(current.property, "Identifier")) {
    return current.property.name;
  }
  return null;
};

const isCustomHookInstanceBinding = (ref: Reference): boolean =>
  Boolean(
    ref.resolved?.defs.some((def) => {
      const node = def.node as unknown as EsTreeNode;
      if (!isNodeOfType(node, "VariableDeclarator") || !node.init) return false;
      const calleeName = getHookCalleeName(node.init as EsTreeNode);
      return calleeName !== null && HOOK_NAME_PATTERN.test(calleeName);
    }),
  );

const isImperativeSyncStatement = (
  analysis: ProgramAnalysis,
  statement: EsTreeNode,
  testedBindings: ReadonlySet<unknown>,
): boolean => {
  if (isSideEffectFreeExit(statement)) return true;
  if (isNodeOfType(statement, "IfStatement")) {
    if (statement.alternate) return false;
    const innerTestedBindings = new Set(testedBindings);
    for (const testRef of getDownstreamRefs(analysis, statement.test as EsTreeNode)) {
      if (testRef.resolved) innerTestedBindings.add(testRef.resolved);
    }
    const innerStatements = getConsequentStatements(statement.consequent as EsTreeNode);
    if (innerStatements.length === 0) return false;
    return innerStatements.every((innerStatement) =>
      isImperativeSyncStatement(analysis, innerStatement, innerTestedBindings),
    );
  }
  if (!isNodeOfType(statement, "ExpressionStatement")) return false;
  let expression = statement.expression as EsTreeNode;
  if (isNodeOfType(expression, "ChainExpression")) {
    expression = expression.expression as EsTreeNode;
  }

  let target: EsTreeNode;
  let invokedName: string | null = null;
  if (isNodeOfType(expression, "CallExpression")) {
    target = expression.callee as EsTreeNode;
    invokedName = getInvokedMemberName(target);
  } else if (isNodeOfType(expression, "AssignmentExpression")) {
    target = expression.left as EsTreeNode;
  } else {
    return false;
  }

  const chain = getImperativeTargetChain(target);
  if (!chain.baseIdentifier) return false;
  // A DIRECT call of a function returned by an opaque custom hook
  // (`goToCell?.({...})` from `useInputState(...)`) is the same
  // external-instance sync as a method call on a hook-returned service
  // (`layerService.show()`) — the hook owns the semantics. useState
  // setters and useReducer dispatches never take this path: React
  // builtins are excluded, so state hops keep firing.
  if (chain.memberDepth === 0) {
    if (!isNodeOfType(expression, "CallExpression")) return false;
    const calleeRef = getRef(analysis, chain.baseIdentifier);
    if (!calleeRef?.resolved) return false;
    if (isState(analysis, calleeRef) || isStateSetter(analysis, calleeRef)) return false;
    if (PARENT_CALLBACK_NAME_PATTERN.test(chain.baseIdentifier.name)) return false;
    return isCustomHookReturnedBinding(calleeRef);
  }
  const baseName = chain.baseIdentifier.name;
  if (IMPERATIVE_ROOT_GLOBAL_NAMES.has(baseName)) return true;
  if (chain.passesThroughRefCurrent) return true;
  if (baseName === "ref" || baseName.endsWith("Ref") || baseName.endsWith("ref")) return true;

  const baseRef = getRef(analysis, chain.baseIdentifier);
  if (!baseRef?.resolved) return false;
  if (isState(analysis, baseRef) || isStateSetter(analysis, baseRef)) return false;
  if (isCustomHookInstanceBinding(baseRef)) return true;
  if (invokedName && PARENT_CALLBACK_NAME_PATTERN.test(invokedName)) return false;
  if (invokedName && DATA_ITERATION_METHOD_NAMES.has(invokedName)) return false;
  if (!testedBindings.has(baseRef.resolved)) return false;
  // `props.search(results)` calls a parent-supplied callback off the whole
  // props object — that is the antipattern, not external-instance sync. A
  // positional custom-hook parameter (`cy` in `useRunLayout(cy)`) is NOT a
  // props object even when non-destructured, so exempt it from the check.
  if (!isCustomHookParameter(baseRef) && isWholePropsObjectReference(analysis, baseRef)) {
    return false;
  }
  return true;
};

const isImperativeSyncConsequent = (
  analysis: ProgramAnalysis,
  ifNode: EsTreeNodeOfType<"IfStatement">,
): boolean => {
  const statements = getConsequentStatements(ifNode.consequent as EsTreeNode);
  if (statements.length === 0) return false;
  if (statements.every((statement) => isSideEffectFreeExit(statement))) return false;
  const testedBindings = new Set<unknown>();
  for (const testRef of getDownstreamRefs(analysis, ifNode.test as EsTreeNode)) {
    if (testRef.resolved) testedBindings.add(testRef.resolved);
  }
  return statements.every((statement) =>
    isImperativeSyncStatement(analysis, statement, testedBindings),
  );
};

// A setter usage that can actually flip the state: invoked directly,
// handed by reference to another call (`then(setX)`), or passed as a JSX
// prop (`onChange={setX}`). A bare mention in a deps array is not one.
const isSetterInvocationUsage = (identifier: EsTreeNode): boolean => {
  const parent = (identifier as unknown as { parent?: EsTreeNode | null }).parent;
  if (!parent) return false;
  if (isNodeOfType(parent, "CallExpression")) {
    if ((parent.callee as unknown) === (identifier as unknown)) return true;
    return (parent.arguments ?? []).some((argument) => (argument as unknown) === identifier);
  }
  return isNodeOfType(parent, "JSXExpressionContainer");
};

// Does the tested state's setter get used anywhere OUTSIDE the mount
// effect itself (an event handler, a child callback prop, a promise)?
// If so, the `[]`-deps effect is still the faked-event-handler intent —
// just with broken deps — not one-time initialization.
const isStateSetterUsedOutsideEffect = (
  analysis: ProgramAnalysis,
  stateRef: Reference,
  effectNode: EsTreeNode,
): boolean => {
  const declarator = stateRef.resolved?.defs
    .map((def) => def.node as unknown as EsTreeNode)
    .find(
      (defNode) =>
        isNodeOfType(defNode, "VariableDeclarator") && isNodeOfType(defNode.id, "ArrayPattern"),
    );
  if (!declarator || !isNodeOfType(declarator, "VariableDeclarator")) return false;
  if (!isNodeOfType(declarator.id, "ArrayPattern")) return false;
  const setterElement = declarator.id.elements?.[1];
  if (!setterElement || !isNodeOfType(setterElement, "Identifier")) return false;
  const setterName = setterElement.name;
  for (const scope of analysis.scopeManager.scopes) {
    const setterVariable = scope.variables.find(
      (variable) =>
        variable.name === setterName &&
        variable.defs.some((def) => (def.node as unknown as EsTreeNode) === declarator),
    );
    if (!setterVariable) continue;
    return setterVariable.references.some((reference) => {
      const identifier = reference.identifier as unknown as EsTreeNode;
      if (isAstDescendant(identifier, effectNode)) return false;
      return isSetterInvocationUsage(identifier);
    });
  }
  return false;
};

// 1:1 port of upstream `src/rules/no-event-handler.js`, narrowed to
// skip pure early-exit guard patterns (`if (!enabled) return;`),
// one-shot ref-guarded effects (`if (wrapperRef.current && ...)`),
// mount-only `[]`-deps initialization effects (tested state never set
// outside the effect), imperative external-interface sync consequents,
// and opaque custom-hook upstream expansion.
export const noEventHandler = defineRule({
  id: "no-event-handler",
  title: "Event logic handled in an effect",
  tags: ["test-noise"],
  severity: "warn",
  recommendation:
    "Run the side effect in the event handler that triggers it, instead of watching its state from a useEffect. See https://react.dev/learn/you-might-not-need-an-effect#sharing-logic-between-event-handlers",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isUseEffect(node)) return;
      // A `[]`-deps effect runs exactly once, on mount. When the tested
      // state is only ever set by that mount-time code, the guard is
      // one-time initialization, not a faked event handler. But a
      // handler-set flag tested under `[]` deps is still the antipattern
      // (just with broken deps), so those keep firing — decided per ref
      // below via `isStateSetterUsedOutsideEffect`.
      const depsArgument = node.arguments?.[1];
      const isMountOnlyEffect = Boolean(
        depsArgument &&
        isNodeOfType(depsArgument, "ArrayExpression") &&
        (depsArgument.elements ?? []).length === 0,
      );
      const analysis = getProgramAnalysis(node);
      if (!analysis) return;
      if (hasCleanup(analysis, node)) return;
      const effectFnRefs = getEffectFnRefs(analysis, node);
      if (!effectFnRefs) return;
      const effectFn = getEffectFn(analysis, node);
      if (!effectFn) return;

      const ifStatementsNoElse = findDownstreamNodes(node, "IfStatement").filter(
        (ifNode) =>
          isNodeOfType(ifNode, "IfStatement") &&
          !ifNode.alternate &&
          !isPureEarlyExitConsequent(ifNode.consequent as EsTreeNode) &&
          !isControlledPropMirrorConsequent(analysis, ifNode) &&
          !containsRefGuard(ifNode.test as EsTreeNode) &&
          !containsPreviousValueComparison(analysis, ifNode.test as EsTreeNode) &&
          !isLocalComputationConsequent(analysis, ifNode, effectFn) &&
          !isEffectLocalOnlyTest(analysis, ifNode, effectFn) &&
          !isDepsListedCallbackInvocationConsequent(analysis, ifNode, node) &&
          !isImperativeSyncConsequent(analysis, ifNode),
      );
      const ifTestRefEntries = ifStatementsNoElse.flatMap((ifNode) => {
        if (!isNodeOfType(ifNode, "IfStatement")) return [];
        const directTestRefs = getDownstreamRefs(analysis, ifNode.test as EsTreeNode);
        // A guard that directly tests data returned by an opaque custom
        // hook (`if (isEditMode && existingTask)` with `existingTask` from
        // an SWR-style fetch hook) fires when ASYNC DATA ARRIVES — the
        // doc's external-source carve-out. Props tested alongside are
        // gating config the parent owns, not values a handler flipped, so
        // prop reports from such guards are suppressed. Handler-set STATE
        // tested by the same guard still fires.
        const isAsyncDataGated = directTestRefs.some((ref) => isOpaqueHookResultBinding(ref));
        // A tested state driven EXCLUSIVELY by a timer / listener / observer /
        // subscription is reacting to an imperative browser event — drop that
        // ref (and the seeds only reachable through it), but keep reporting
        // the other props / handler-driven state tested by the same guard.
        return directTestRefs
          .filter((ref) => !(isState(analysis, ref) && isExternallyDrivenState(analysis, ref)))
          .flatMap((ref) => getGuardUpstreamRefs(analysis, ref))
          .map((ref) => ({ ref, isAsyncDataGated }));
      });

      // Dedupe by resolved binding (not identifier identity) so a
      // single useEffect use of a prop doesn't emit one diagnostic per
      // reference site in the file. A binding reached from BOTH an
      // async-data-gated guard and a plain guard stays prop-reportable.
      const seenBindings = new Map<unknown, { isAsyncDataGated: boolean }>();
      const seenIdentifiers = new Set<EsTreeNode>();
      const dedupedEntries: Array<{ ref: Reference; isAsyncDataGated: boolean }> = [];
      for (const entry of ifTestRefEntries) {
        const identifier = entry.ref.identifier as unknown as EsTreeNode;
        if (!identifier) continue;
        const resolved = (entry.ref as unknown as { resolved?: unknown }).resolved;
        if (resolved) {
          const seen = seenBindings.get(resolved);
          if (seen) {
            if (!entry.isAsyncDataGated) seen.isAsyncDataGated = false;
            continue;
          }
          seenBindings.set(resolved, entry);
        }
        if (seenIdentifiers.has(identifier)) continue;
        seenIdentifiers.add(identifier);
        dedupedEntries.push(entry);
      }
      const dedupedRefs = dedupedEntries.map((entry) => entry.ref);

      for (const ref of dedupedRefs) {
        if (isState(analysis, ref)) {
          // State written from a timer / listener / observer / promise /
          // subscription changes in response to an imperative browser event,
          // not a React event handler, so there is no handler to fold into.
          if (isExternallyDrivenState(analysis, ref)) continue;
          if (isMountOnlyEffect && !isStateSetterUsedOutsideEffect(analysis, ref, node)) {
            continue;
          }
          context.report({
            node: ref.identifier as unknown as EsTreeNode,
            message:
              "Faking an event handler with state plus a useEffect costs an extra render & runs late.",
          });
        }
      }
      for (const entry of dedupedEntries) {
        if (isProp(analysis, entry.ref)) {
          // A prop read once in a mount effect is initialization input —
          // the parent cannot re-trigger a `[]`-deps effect by changing it.
          if (isMountOnlyEffect) continue;
          if (entry.isAsyncDataGated) continue;
          context.report({
            node: entry.ref.identifier as unknown as EsTreeNode,
            message:
              "Faking an event handler with a prop plus a useEffect costs an extra render & runs late.",
          });
        }
      }
    },
  }),
});
