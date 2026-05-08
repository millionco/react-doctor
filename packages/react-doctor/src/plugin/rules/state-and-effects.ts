import {
  BUILTIN_GLOBAL_NAMESPACE_NAMES,
  CASCADING_SET_STATE_THRESHOLD,
  CLEANUP_LIKE_RELEASE_CALLEE_NAMES,
  EFFECT_HOOK_NAMES,
  EVENT_TRIGGERED_NAVIGATION_METHOD_NAMES,
  EVENT_TRIGGERED_SIDE_EFFECT_CALLEES,
  EVENT_TRIGGERED_SIDE_EFFECT_MEMBER_METHODS,
  EXTERNAL_SYNC_AMBIGUOUS_HTTP_METHOD_NAMES,
  EXTERNAL_SYNC_DIRECT_CALLEE_NAMES,
  EXTERNAL_SYNC_HTTP_CLIENT_RECEIVERS,
  EXTERNAL_SYNC_MEMBER_METHOD_NAMES,
  EXTERNAL_SYNC_OBSERVER_CONSTRUCTORS,
  HOOKS_WITH_DEPS,
  MUTABLE_GLOBAL_ROOTS,
  MUTATING_ARRAY_METHODS,
  NAVIGATION_RECEIVER_NAMES,
  REACT_HANDLER_PROP_PATTERN,
  RELATED_USE_STATE_THRESHOLD,
  SUBSCRIPTION_METHOD_NAMES,
  TIMER_AND_SCHEDULER_DIRECT_CALLEE_NAMES,
  TIMER_CALLEE_NAMES_REQUIRING_CLEANUP,
  TIMER_CLEANUP_CALLEE_NAMES,
  TRIVIAL_DERIVATION_CALLEE_NAMES,
  TRIVIAL_INITIALIZER_NAMES,
  UNSUBSCRIPTION_METHOD_NAMES,
} from "../constants.js";
import {
  areExpressionsStructurallyEqual,
  collectPatternNames,
  containsFetchCall,
  countSetStateCalls,
  createComponentBindingStackTracker,
  createComponentPropStackTracker,
  getCallbackStatements,
  getEffectCallback,
  getRootIdentifierName,
  isComponentAssignment,
  isHookCall,
  isSetterCall,
  isSetterIdentifier,
  isUppercaseName,
  walkAst,
  walkInsideStatementBlocks,
} from "../helpers.js";
import type { EsTreeNode, Rule, RuleContext } from "../types.js";

// HACK: AST-aware walker for "what reactive values does this expression
// actually READ?". The plain `walkAst` adds every Identifier it sees,
// which over-counts in two ways:
//   - the CALLEE of a CallExpression (`getFilteredTodos(...)`) is a
//     function reference, almost always module-scoped and stable —
//     React's exhaustive-deps lint correctly omits these from deps.
//   - the PROPERTY of a non-computed MemberExpression (`obj.foo`) is
//     a static identifier, not a separate reactive read; only `obj`
//     is the reactive value.
// Without this, `setX(getFilteredTodos(todos, filter))` would treat
// `getFilteredTodos` as a missing dep and bail before the §2 "expensive
// derivation" branch could fire.
const collectValueIdentifierNames = (node: EsTreeNode | null | undefined, into: string[]): void => {
  if (!node || typeof node !== "object") return;
  if (node.type === "CallExpression") {
    if (node.callee?.type === "MemberExpression") {
      // For `state.method(arg)`, `state` is a reactive read; `method`
      // is not. Skip the callee chain entirely when its root is a
      // built-in global (`Math.floor`, `JSON.parse`, ...) — those
      // aren't reactive reads either.
      const rootName = getRootIdentifierName(node.callee);
      if (!rootName || !BUILTIN_GLOBAL_NAMESPACE_NAMES.has(rootName)) {
        collectValueIdentifierNames(node.callee.object, into);
      }
    }
    for (const argument of node.arguments ?? []) {
      collectValueIdentifierNames(argument, into);
    }
    return;
  }
  if (node.type === "MemberExpression") {
    const rootName = getRootIdentifierName(node);
    if (!rootName || !BUILTIN_GLOBAL_NAMESPACE_NAMES.has(rootName)) {
      collectValueIdentifierNames(node.object, into);
    }
    if (node.computed) collectValueIdentifierNames(node.property, into);
    return;
  }
  if (node.type === "Identifier") {
    into.push(node.name);
    return;
  }
  for (const key of Object.keys(node)) {
    if (key === "parent" || key === "type") continue;
    const child = node[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        if (item && typeof item === "object" && item.type) {
          collectValueIdentifierNames(item, into);
        }
      }
    } else if (child && typeof child === "object" && child.type) {
      collectValueIdentifierNames(child, into);
    }
  }
};

export const noDerivedStateEffect: Rule = {
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNode) {
      if (!isHookCall(node, EFFECT_HOOK_NAMES) || (node.arguments?.length ?? 0) < 2) return;

      const callback = getEffectCallback(node);
      if (!callback) return;

      const depsNode = node.arguments[1];
      if (depsNode.type !== "ArrayExpression" || !depsNode.elements?.length) return;

      const dependencyNames = new Set(
        depsNode.elements
          .filter((element: EsTreeNode) => element?.type === "Identifier")
          .map((element: EsTreeNode) => element.name),
      );
      if (dependencyNames.size === 0) return;

      const statements = getCallbackStatements(callback);
      if (statements.length === 0) return;

      const containsOnlySetStateCalls = statements.every((statement: EsTreeNode) => {
        if (statement.type !== "ExpressionStatement") return false;
        return isSetterCall(statement.expression);
      });
      if (!containsOnlySetStateCalls) return;

      let allArgumentsDeriveFromDeps = true;
      let hasAnyDependencyReference = false;
      // §2 of "You Might Not Need an Effect" branches the suggested
      // fix on whether the derivation is potentially expensive. A
      // setter argument that contains a user-defined CallExpression
      // (e.g. `setVisibleTodos(getFilteredTodos(todos, filter))`)
      // gets the `useMemo` recommendation; pure data shaping like
      // `firstName + " " + lastName` keeps the cheaper "compute
      // during render" message.
      let hasExpensiveDerivation = false;
      for (const statement of statements) {
        const setStateArguments = statement.expression.arguments;
        if (!setStateArguments?.length) continue;

        const valueIdentifierNames: string[] = [];
        collectValueIdentifierNames(setStateArguments[0], valueIdentifierNames);

        walkAst(setStateArguments[0], (child: EsTreeNode) => {
          if (child.type !== "CallExpression") return;
          if (child.callee?.type === "MemberExpression") {
            // `Math.floor(x)` / `Date.now()` are trivial regardless
            // of the property — gate on the chain root, not the
            // method name (which would never match TRIVIAL_*).
            const rootName = getRootIdentifierName(child.callee);
            if (rootName && BUILTIN_GLOBAL_NAMESPACE_NAMES.has(rootName)) return;
            hasExpensiveDerivation = true;
            return;
          }
          if (child.callee?.type === "Identifier") {
            const calleeName = child.callee.name;
            if (
              !TRIVIAL_DERIVATION_CALLEE_NAMES.has(calleeName) &&
              !isSetterIdentifier(calleeName)
            ) {
              hasExpensiveDerivation = true;
            }
          }
        });

        const nonSetterIdentifiers = valueIdentifierNames.filter(
          (name) => !isSetterIdentifier(name),
        );

        if (nonSetterIdentifiers.some((name) => dependencyNames.has(name))) {
          hasAnyDependencyReference = true;
        }

        if (nonSetterIdentifiers.some((name) => !dependencyNames.has(name))) {
          allArgumentsDeriveFromDeps = false;
          break;
        }
      }

      if (!allArgumentsDeriveFromDeps) return;

      // HACK: a user-defined function call inside the setter arg
      // (`setFilteredItems(applyFilters())`) closes over reactive
      // values implicitly — it's a derivation, not a "state reset".
      // Without this, a zero-arg call would leave the identifier list
      // empty and the message would vacuously default to the wrong
      // "state reset" branch.
      if (hasExpensiveDerivation) hasAnyDependencyReference = true;

      let message: string;
      if (!hasAnyDependencyReference) {
        message =
          "State reset in useEffect — use a key prop to reset component state when props change";
      } else if (hasExpensiveDerivation) {
        message =
          "Derived state in useEffect — wrap the calculation in useMemo([deps]) (or compute it directly during render if it isn't expensive)";
      } else {
        message = "Derived state in useEffect — compute during render instead";
      }

      context.report({ node, message });
    },
  }),
};

export const noFetchInEffect: Rule = {
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNode) {
      if (!isHookCall(node, EFFECT_HOOK_NAMES)) return;
      const callback = getEffectCallback(node);
      if (!callback) return;

      if (containsFetchCall(callback)) {
        context.report({
          node,
          message:
            "fetch() inside useEffect — use a data fetching library (react-query, SWR) or server component",
        });
      }
    },
  }),
};

export const noCascadingSetState: Rule = {
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNode) {
      if (!isHookCall(node, EFFECT_HOOK_NAMES)) return;
      const callback = getEffectCallback(node);
      if (!callback) return;

      const setStateCallCount = countSetStateCalls(callback);
      if (setStateCallCount >= CASCADING_SET_STATE_THRESHOLD) {
        context.report({
          node,
          message: `${setStateCallCount} setState calls in a single useEffect — consider using useReducer or deriving state`,
        });
      }
    },
  }),
};

export const noEffectEventHandler: Rule = {
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNode) {
      if (!isHookCall(node, EFFECT_HOOK_NAMES) || (node.arguments?.length ?? 0) < 2) return;

      const callback = getEffectCallback(node);
      if (!callback) return;

      const depsNode = node.arguments[1];
      if (depsNode.type !== "ArrayExpression" || !depsNode.elements?.length) return;

      const dependencyNames = new Set(
        depsNode.elements
          .filter((element: EsTreeNode) => element?.type === "Identifier")
          .map((element: EsTreeNode) => element.name),
      );

      const statements = getCallbackStatements(callback);
      if (statements.length !== 1) return;

      const soleStatement = statements[0];
      if (soleStatement.type !== "IfStatement") return;

      // HACK: §5 of "You Might Not Need an Effect" uses
      // `if (product.isInCart)` — a MemberExpression, not a bare
      // Identifier. The earlier detector hard-required `Identifier`
      // and missed the article's literal example. Walk the test
      // down to its root identifier so both shapes match:
      //   if (isOpen)            → root = "isOpen"
      //   if (product.isInCart)  → root = "product"
      const rootIdentifierName = getRootIdentifierName(soleStatement.test);
      if (!rootIdentifierName || !dependencyNames.has(rootIdentifierName)) return;

      // Don't defer to `noEventTriggerState` here. The previous
      // implementation tried to ("if the body looks event-shaped,
      // let the more specific rule report"), but that deference
      // could silently drop diagnostics: `noEventTriggerState`
      // requires several preconditions this visitor can't cheaply
      // verify (single dep, handler-only writes for that state,
      // and not render-reachable). When any of those failed, the
      // narrow rule didn't fire AND this rule deferred, so the
      // user got nothing. Both rules fire independently — the two
      // messages frame the same code differently ("this useEffect
      // simulates a handler" vs "this state exists only to schedule
      // X from an effect") and a duplicate diagnostic is strictly
      // better than a silent drop.
      context.report({
        node,
        message:
          "useEffect simulating an event handler — move logic to an actual event handler instead",
      });
    },
  }),
};

export const noDerivedUseState: Rule = {
  create: (context: RuleContext) => {
    const propStackTracker = createComponentPropStackTracker();

    return {
      ...propStackTracker.visitors,
      CallExpression(node: EsTreeNode) {
        if (!isHookCall(node, "useState") || !node.arguments?.length) return;
        const initializer = node.arguments[0];

        if (initializer.type === "Identifier" && propStackTracker.isPropName(initializer.name)) {
          context.report({
            node,
            message: `useState initialized from prop "${initializer.name}" — if this value should stay in sync with the prop, derive it during render instead`,
          });
          return;
        }

        if (initializer.type === "MemberExpression" && !initializer.computed) {
          const rootIdentifierName = getRootIdentifierName(initializer);
          if (rootIdentifierName && propStackTracker.isPropName(rootIdentifierName)) {
            context.report({
              node,
              message: `useState initialized from prop "${rootIdentifierName}" — if this value should stay in sync with the prop, derive it during render instead`,
            });
          }
        }
      },
    };
  },
};

export const preferUseReducer: Rule = {
  create: (context: RuleContext) => {
    const reportExcessiveUseState = (body: EsTreeNode, componentName: string): void => {
      if (body.type !== "BlockStatement") return;
      let useStateCount = 0;
      for (const statement of body.body ?? []) {
        if (statement.type !== "VariableDeclaration") continue;
        for (const declarator of statement.declarations ?? []) {
          if (isHookCall(declarator.init, "useState")) useStateCount++;
        }
      }
      if (useStateCount >= RELATED_USE_STATE_THRESHOLD) {
        context.report({
          node: body,
          message: `Component "${componentName}" has ${useStateCount} useState calls — consider useReducer for related state`,
        });
      }
    };

    return {
      FunctionDeclaration(node: EsTreeNode) {
        if (!node.id?.name || !isUppercaseName(node.id.name)) return;
        reportExcessiveUseState(node.body, node.id.name);
      },
      VariableDeclarator(node: EsTreeNode) {
        if (!isComponentAssignment(node)) return;
        reportExcessiveUseState(node.init.body, node.id.name);
      },
    };
  },
};

export const rerenderLazyStateInit: Rule = {
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNode) {
      if (!isHookCall(node, "useState") || !node.arguments?.length) return;
      const initializer = node.arguments[0];
      if (initializer.type !== "CallExpression") return;

      const calleeName =
        initializer.callee?.type === "Identifier"
          ? initializer.callee.name
          : (initializer.callee?.property?.name ?? "fn");

      if (TRIVIAL_INITIALIZER_NAMES.has(calleeName)) return;

      context.report({
        node: initializer,
        message: `useState(${calleeName}()) calls initializer on every render — use useState(() => ${calleeName}()) for lazy initialization`,
      });
    },
  }),
};

const STATE_ARITHMETIC_OPERATORS = new Set(["+", "-", "*", "/", "%", "**"]);

// HACK: derive the state variable name from the setter name. `setCount` →
// `count`. We only flag arithmetic when one operand actually matches that
// derived name; otherwise `setCount(1 + computedValue)` would false-positive
// against any incidental Identifier on either side.
const deriveStateVariableName = (setterName: string): string | null => {
  if (!setterName.startsWith("set") || setterName.length < 4) return null;
  return setterName.charAt(3).toLowerCase() + setterName.slice(4);
};

export const rerenderFunctionalSetstate: Rule = {
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNode) {
      if (!isSetterCall(node)) return;
      if (!node.arguments?.length) return;

      const calleeName = node.callee.name;
      const argument = node.arguments[0];
      const expectedStateName = deriveStateVariableName(calleeName);

      if (
        argument.type === "BinaryExpression" &&
        STATE_ARITHMETIC_OPERATORS.has(argument.operator) &&
        expectedStateName
      ) {
        const matchesExpected = (operand: EsTreeNode | undefined): boolean =>
          operand?.type === "Identifier" && operand.name === expectedStateName;

        const stateIdentifier = matchesExpected(argument.left)
          ? argument.left
          : matchesExpected(argument.right)
            ? argument.right
            : null;

        if (stateIdentifier) {
          context.report({
            node,
            message: `${calleeName}(${stateIdentifier.name} ${argument.operator} ...) — use functional update to avoid stale closures`,
          });
          return;
        }
      }

      if (
        argument.type === "UpdateExpression" &&
        (argument.operator === "++" || argument.operator === "--") &&
        argument.argument?.type === "Identifier" &&
        argument.argument.name === expectedStateName
      ) {
        const display = argument.prefix
          ? `${argument.operator}${argument.argument.name}`
          : `${argument.argument.name}${argument.operator}`;
        context.report({
          node,
          message: `${calleeName}(${display}) — use functional update to avoid stale closures (and reading the post-increment value bug)`,
        });
        return;
      }

      // HACK: 'Removing Effect Dependencies' §"Are you reading some
      // state to calculate the next state?" — the array/object spread
      // shape is the most common stale-closure trap in
      // subscription-handler / setInterval callbacks:
      //
      //   setMessages([...messages, receivedMessage]);   // stale
      //   setMessages(msgs => [...msgs, receivedMessage]); // ok
      //
      // Detect when one of the spread sources structurally references
      // the derived state variable: `setX([...x, ...])` or
      // `setX({ ...x, key: value })`.
      if (expectedStateName && argument.type === "ArrayExpression") {
        const spreadsState = (argument.elements ?? []).some(
          (element: EsTreeNode | null) =>
            element?.type === "SpreadElement" &&
            element.argument?.type === "Identifier" &&
            element.argument.name === expectedStateName,
        );
        if (spreadsState) {
          context.report({
            node,
            message: `${calleeName}([...${expectedStateName}, ...]) — use functional update \`${calleeName}(prev => [...prev, ...])\` to avoid stale closures`,
          });
          return;
        }
      }

      if (expectedStateName && argument.type === "ObjectExpression") {
        const spreadsState = (argument.properties ?? []).some(
          (property: EsTreeNode | null) =>
            property?.type === "SpreadElement" &&
            property.argument?.type === "Identifier" &&
            property.argument.name === expectedStateName,
        );
        if (spreadsState) {
          context.report({
            node,
            message: `${calleeName}({ ...${expectedStateName}, ... }) — use functional update \`${calleeName}(prev => ({ ...prev, ... }))\` to avoid stale closures`,
          });
          return;
        }
      }
    },
  }),
};

export const rerenderDependencies: Rule = {
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNode) {
      if (!isHookCall(node, HOOKS_WITH_DEPS) || node.arguments.length < 2) return;
      const depsNode = node.arguments[1];
      if (depsNode.type !== "ArrayExpression") return;

      for (const element of depsNode.elements ?? []) {
        if (!element) continue;
        if (element.type === "ObjectExpression") {
          context.report({
            node: element,
            message:
              "Object literal in useEffect deps — creates new reference every render, causing infinite re-runs",
          });
        }
        if (element.type === "ArrayExpression") {
          context.report({
            node: element,
            message:
              "Array literal in useEffect deps — creates new reference every render, causing infinite re-runs",
          });
        }
        // HACK: arrow / function expressions create a fresh function
        // reference every render, same problem as object/array literals.
        // The fix is to either lift the function out of the component
        // (if it doesn't read reactive values) or wrap it in
        // `useCallback`. Covered by `Removing Effect Dependencies` §
        // "Does some reactive value change unintentionally?".
        if (element.type === "ArrowFunctionExpression" || element.type === "FunctionExpression") {
          context.report({
            node: element,
            message:
              "Inline function in useEffect deps — creates a new function reference every render, causing infinite re-runs. Hoist it out of the component or wrap it with useCallback",
          });
        }
      }
    },
  }),
};

// HACK: `useEffect(() => parentCallback(state.x), [state.x])` is the
// "lift state up via callback" anti-pattern: the child owns state, then
// fires a parent callback every time the state changes to keep the
// parent in sync. The parent has no real ground-truth state, just a
// stale mirror. The right shape is to lift state into a Provider that
// both child and parent read from; the child then doesn't need an
// effect-driven sync at all.
export const noPropCallbackInEffect: Rule = {
  create: (context: RuleContext) => {
    const propStackTracker = createComponentPropStackTracker();

    return {
      ...propStackTracker.visitors,
      CallExpression(node: EsTreeNode) {
        if (!isHookCall(node, EFFECT_HOOK_NAMES) || (node.arguments?.length ?? 0) < 2) return;
        const callback = getEffectCallback(node);
        if (!callback) return;
        const depsNode = node.arguments[1];
        if (depsNode.type !== "ArrayExpression" || !depsNode.elements?.length) return;

        // Only flag if at least one dep is a non-prop (state-shape)
        // identifier — otherwise the effect is just adapting to prop
        // changes (legit pattern).
        const hasStateLikeDep = depsNode.elements.some(
          (element: EsTreeNode) =>
            element?.type === "Identifier" && !propStackTracker.isPropName(element.name),
        );
        if (!hasStateLikeDep) return;

        // HACK: walk control-flow descendants (`if`, `try`, `for`,
        // `switch`) but stop at any nested function boundary so calls
        // inside `setTimeout(() => onChange(state))` aren't conflated
        // with the top-level `onChange(state)` shape — those belong to
        // `prefer-use-effect-event` (sub-handler reads), not this rule
        // (lift state via callback).
        const reportedNodes = new Set<EsTreeNode>();
        walkInsideStatementBlocks(callback.body, (child: EsTreeNode) => {
          if (child.type !== "CallExpression") return;
          if (child.callee?.type !== "Identifier") return;
          const calleeName = child.callee.name;
          if (!propStackTracker.isPropName(calleeName)) return;
          if (reportedNodes.has(child)) return;
          reportedNodes.add(child);
          context.report({
            node: child,
            message: `useEffect calls prop callback "${calleeName}" with local state in deps — this is the "lift state via callback" anti-pattern; lift state into a shared Provider so both sides read the same source`,
          });
        });
      },
    };
  },
};

// HACK: useEffectEvent's identity is intentionally unstable — it captures
// the latest props/state on each call. Listing it in a useEffect/useMemo/
// useCallback dep array fundamentally misuses the API and would cause the
// effect to re-run constantly. The recommended pattern is to call the
// effect-event from inside the effect body without listing it as a dep.
//
// Bindings are scoped per-component using a stack so a `useEffectEvent`
// binding named `onChange` in ComponentA doesn't taint a regular variable
// `onChange` in ComponentB in the same file.
export const noEffectEventInDeps: Rule = {
  create: (context: RuleContext) => {
    const componentBindings = createComponentBindingStackTracker({
      onVariableDeclarator: (declaratorNode: EsTreeNode) => {
        if (declaratorNode.id?.type !== "Identifier") return;
        const initializer = declaratorNode.init;
        if (!initializer || initializer.type !== "CallExpression") return;
        if (!isHookCall(initializer, "useEffectEvent")) return;
        componentBindings.addBindingToCurrentFrame(declaratorNode.id.name);
      },
    });

    return {
      ...componentBindings.visitors,
      CallExpression(node: EsTreeNode) {
        if (!isHookCall(node, HOOKS_WITH_DEPS) || node.arguments.length < 2) return;
        if (!componentBindings.isInsideComponent()) return;
        const depsNode = node.arguments[1];
        if (depsNode.type !== "ArrayExpression") return;

        for (const element of depsNode.elements ?? []) {
          if (element?.type !== "Identifier") continue;
          if (componentBindings.isBoundName(element.name)) {
            context.report({
              node: element,
              message: `"${element.name}" is from useEffectEvent and must not be in the deps array — its identity is intentionally unstable; call it inside the effect without listing it`,
            });
          }
        }
      },
    };
  },
};

// HACK: a useState whose value is never read in the component's JSX
// return is by definition not visual state — every setState triggers a
// render that produces the same DOM. Use `useRef` (`ref.current = ...`)
// so updates don't trigger re-renders. (For values read inside an
// addEventListener-style callback, a ref also lets the handler always
// see the latest value without re-subscribing each effect run.)
const collectUseStateBindings = (
  componentBody: EsTreeNode,
): Array<{ valueName: string; setterName: string; declarator: EsTreeNode }> => {
  const bindings: Array<{ valueName: string; setterName: string; declarator: EsTreeNode }> = [];
  if (componentBody?.type !== "BlockStatement") return bindings;

  for (const statement of componentBody.body ?? []) {
    if (statement.type !== "VariableDeclaration") continue;
    for (const declarator of statement.declarations ?? []) {
      if (declarator.id?.type !== "ArrayPattern") continue;
      const elements = declarator.id.elements ?? [];
      if (elements.length < 2) continue;
      const valueElement = elements[0];
      const setterElement = elements[1];
      if (
        valueElement?.type !== "Identifier" ||
        setterElement?.type !== "Identifier" ||
        !isSetterIdentifier(setterElement.name)
      ) {
        continue;
      }
      if (declarator.init?.type !== "CallExpression") continue;
      if (!isHookCall(declarator.init, "useState")) continue;
      bindings.push({
        valueName: valueElement.name,
        setterName: setterElement.name,
        declarator,
      });
    }
  }
  return bindings;
};

// HACK: only collect return statements at the COMPONENT'S top level —
// nested function bodies (effect cleanups, useMemo/useCallback callbacks)
// have their own return semantics that aren't render output.
const collectReturnExpressions = (componentBody: EsTreeNode): EsTreeNode[] => {
  if (componentBody?.type !== "BlockStatement") return [];
  const returns: EsTreeNode[] = [];
  for (const statement of componentBody.body ?? []) {
    if (statement.type === "ReturnStatement" && statement.argument) {
      returns.push(statement.argument);
      continue;
    }
    // Walk into IfStatement / TryStatement etc. for early-return JSX,
    // but stop at any nested function.
    walkInsideStatementBlocks(statement, (child) => {
      if (child.type === "ReturnStatement" && child.argument) {
        returns.push(child.argument);
      }
    });
  }
  return returns;
};

const collectIdentifierNames = (expression: EsTreeNode): Set<string> => {
  const names = new Set<string>();
  walkAst(expression, (child: EsTreeNode) => {
    if (child.type === "Identifier") names.add(child.name);
  });
  return names;
};

// Build a "name -> identifiers it transitively depends on" graph for
// every top-level VariableDeclarator in the component body. Includes
// names referenced anywhere inside the initializer (deps arrays, nested
// callbacks, member access — we deliberately over-approximate here so
// that `useMemo(() => derive(state), [state])` propagates `state` into
// the dependency set of the resulting variable).
const buildLocalDependencyGraph = (componentBody: EsTreeNode): Map<string, Set<string>> => {
  const graph = new Map<string, Set<string>>();
  if (componentBody?.type !== "BlockStatement") return graph;
  const declaredNames = new Set<string>();
  for (const statement of componentBody.body ?? []) {
    if (statement.type !== "VariableDeclaration") continue;
    for (const declarator of statement.declarations ?? []) {
      if (!declarator.init) continue;
      const dependencyNames = collectIdentifierNames(declarator.init);
      declaredNames.clear();
      collectPatternNames(declarator.id, declaredNames);
      for (const declaredName of declaredNames) {
        const existing = graph.get(declaredName);
        if (existing === undefined) {
          graph.set(declaredName, new Set(dependencyNames));
        } else {
          for (const dependencyName of dependencyNames) existing.add(dependencyName);
        }
      }
    }
  }
  return graph;
};

// "Read in render" = any identifier (`Identifier`, NOT `JSXIdentifier`)
// that appears anywhere inside a return expression — JSX text content,
// `{expression}` containers, attribute values like
// `<MyContext value={value}>` (the React Context case from #146),
// `style={…}`, `className={…}`, props passed to children, conditional
// chains, the lot. JSX element/tag names are `JSXIdentifier`, which we
// deliberately do not track — referring to a component by name does
// not "read" any value.
const collectRenderReachableNames = (returnExpressions: EsTreeNode[]): Set<string> => {
  const names = new Set<string>();
  for (const expression of returnExpressions) {
    walkAst(expression, (child: EsTreeNode) => {
      if (child.type === "Identifier") names.add(child.name);
    });
  }
  return names;
};

const expandTransitiveDependencies = (
  seedNames: Set<string>,
  dependencyGraph: Map<string, Set<string>>,
): Set<string> => {
  const reachable = new Set(seedNames);
  const queue: string[] = Array.from(seedNames);
  while (queue.length > 0) {
    const currentName = queue.pop();
    if (currentName === undefined) continue;
    const dependencyNames = dependencyGraph.get(currentName);
    if (!dependencyNames) continue;
    for (const dependencyName of dependencyNames) {
      if (reachable.has(dependencyName)) continue;
      reachable.add(dependencyName);
      queue.push(dependencyName);
    }
  }
  return reachable;
};

export const rerenderStateOnlyInHandlers: Rule = {
  create: (context: RuleContext) => {
    const checkComponent = (componentBody: EsTreeNode | null | undefined): void => {
      if (!componentBody || componentBody.type !== "BlockStatement") return;
      const bindings = collectUseStateBindings(componentBody);
      if (bindings.length === 0) return;

      const returnExpressions = collectReturnExpressions(componentBody);
      if (returnExpressions.length === 0) return;

      const dependencyGraph = buildLocalDependencyGraph(componentBody);
      const directRenderNames = collectRenderReachableNames(returnExpressions);
      const renderReachableNames = expandTransitiveDependencies(directRenderNames, dependencyGraph);

      for (const binding of bindings) {
        if (renderReachableNames.has(binding.valueName)) continue;

        let setterCalled = false;
        walkAst(componentBody, (child: EsTreeNode) => {
          if (setterCalled) return;
          if (
            child.type === "CallExpression" &&
            child.callee?.type === "Identifier" &&
            child.callee.name === binding.setterName
          ) {
            setterCalled = true;
          }
        });
        if (!setterCalled) continue;

        context.report({
          node: binding.declarator,
          message: `useState "${binding.valueName}" is updated but never read in the component's return — use useRef so updates don't trigger re-renders`,
        });
      }
    };

    return {
      FunctionDeclaration(node: EsTreeNode) {
        if (!node.id?.name || !isUppercaseName(node.id.name)) return;
        checkComponent(node.body);
      },
      VariableDeclarator(node: EsTreeNode) {
        if (!isComponentAssignment(node)) return;
        checkComponent(node.init?.body);
      },
    };
  },
};

// HACK: `useEffect(() => { window.addEventListener(name, handler);
// return () => window.removeEventListener(name, handler); }, [handler])`
// is the canonical "I want the latest handler" anti-pattern: every time
// the parent re-renders with a new `handler` prop, the effect tears
// down and re-subscribes. This thrashes the listener for no reason —
// the subscription itself doesn't change, only the function it points
// to. Store the handler in a ref (`handlerRef.current = handler` in a
// separate effect or a layout effect) and have the registered listener
// read `handlerRef.current()`, then take `handler` out of the deps.
//
// Heuristic: useEffect whose dep array contains an identifier (must be
// a function-typed prop or local in practice — we approximate by
// requiring it to also appear as the second argument to
// `addEventListener`/`subscribe`-shaped calls inside the effect body).
// The shared `SUBSCRIPTION_METHOD_NAMES` set comes from `constants.ts`
// so this rule and `prefer-use-sync-external-store` agree on what
// counts as a subscription-shaped call (zustand/Redux `subscribe`,
// browser `addEventListener`, EventEmitter `on`, etc.).

export const advancedEventHandlerRefs: Rule = {
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNode) {
      if (!isHookCall(node, EFFECT_HOOK_NAMES)) return;
      if ((node.arguments?.length ?? 0) < 2) return;
      const callback = getEffectCallback(node);
      if (!callback) return;
      const depsNode = node.arguments[1];
      if (depsNode.type !== "ArrayExpression" || !depsNode.elements?.length) return;

      const depIdentifierNames = new Set<string>();
      for (const element of depsNode.elements) {
        if (element?.type === "Identifier") depIdentifierNames.add(element.name);
      }
      if (depIdentifierNames.size === 0) return;

      // Look for an addEventListener (etc.) call inside the body whose
      // second argument is one of our deps.
      let registeredHandlerName: string | null = null;
      walkAst(callback.body, (child: EsTreeNode) => {
        if (registeredHandlerName) return;
        if (child.type !== "CallExpression") return;
        if (child.callee?.type !== "MemberExpression") return;
        if (child.callee.property?.type !== "Identifier") return;
        if (!SUBSCRIPTION_METHOD_NAMES.has(child.callee.property.name)) return;
        const handlerArg = child.arguments?.[1];
        if (handlerArg?.type !== "Identifier") return;
        if (depIdentifierNames.has(handlerArg.name)) {
          registeredHandlerName = handlerArg.name;
        }
      });

      if (registeredHandlerName) {
        context.report({
          node,
          message: `useEffect re-subscribes a "${registeredHandlerName}" listener every time the handler identity changes — store the handler in a ref and have the listener read \`handlerRef.current()\`, then drop it from the deps`,
        });
      }
    },
  }),
};

const DEFERRABLE_HOOK_NAMES = new Set(["useSearchParams", "useParams", "usePathname"]);

const findHookCallBindings = (
  componentBody: EsTreeNode,
): Array<{ valueName: string; hookName: string; declarator: EsTreeNode }> => {
  const bindings: Array<{ valueName: string; hookName: string; declarator: EsTreeNode }> = [];
  if (componentBody?.type !== "BlockStatement") return bindings;

  for (const statement of componentBody.body ?? []) {
    if (statement.type !== "VariableDeclaration") continue;
    for (const declarator of statement.declarations ?? []) {
      if (declarator.id?.type !== "Identifier") continue;
      if (declarator.init?.type !== "CallExpression") continue;
      const callee = declarator.init.callee;
      if (callee?.type !== "Identifier") continue;
      if (!DEFERRABLE_HOOK_NAMES.has(callee.name)) continue;
      bindings.push({
        valueName: declarator.id.name,
        hookName: callee.name,
        declarator,
      });
    }
  }
  return bindings;
};

// HACK: collect names of identifiers passed as values to JSX `on*`
// attributes — these are component-bound handlers (`onClick={handleClick}`).
// Lets `isInsideEventHandler` resolve a function bound to a const back
// to its handler usage in JSX.
const collectHandlerBindingNames = (componentBody: EsTreeNode): Set<string> => {
  const handlerNames = new Set<string>();
  walkAst(componentBody, (child: EsTreeNode) => {
    if (child.type !== "JSXAttribute") return;
    if (child.name?.type !== "JSXIdentifier") return;
    if (!/^on[A-Z]/.test(child.name.name)) return;
    if (child.value?.type !== "JSXExpressionContainer") return;
    const expression = child.value.expression;
    if (expression?.type === "Identifier") handlerNames.add(expression.name);
  });
  return handlerNames;
};

const isInsideEventHandler = (node: EsTreeNode, handlerBindingNames: Set<string>): boolean => {
  let cursor: EsTreeNode | null = node.parent ?? null;
  while (cursor) {
    if (
      cursor.type === "ArrowFunctionExpression" ||
      cursor.type === "FunctionExpression" ||
      cursor.type === "FunctionDeclaration"
    ) {
      let outer: EsTreeNode | null = cursor.parent ?? null;
      while (outer) {
        if (outer.type === "JSXAttribute") {
          const attrName = outer.name?.type === "JSXIdentifier" ? outer.name.name : null;
          if (attrName && /^on[A-Z]/.test(attrName)) return true;
          return false;
        }
        if (outer.type === "VariableDeclarator") {
          const declaredName = outer.id?.type === "Identifier" ? outer.id.name : null;
          return Boolean(declaredName && handlerBindingNames.has(declaredName));
        }
        if (outer.type === "Program") return false;
        outer = outer.parent ?? null;
      }
      return false;
    }
    cursor = cursor.parent ?? null;
  }
  return false;
};

// HACK: subscribing to `useSearchParams()` / `useParams()` /
// `usePathname()` makes the component re-render whenever the URL state
// changes — even when the component only reads the value inside an
// onClick / onSubmit handler. In that case the value is read at click
// time anyway; the subscription is wasted work.
//
// Better pattern: read inside the handler via the underlying API
// (`new URL(window.location.href).searchParams`), or build a small
// custom hook that exposes a `getSearchParams()` getter without
// subscribing. The result is fewer renders without losing the data.
//
// Heuristic: hook value-name appears only inside arrow / function
// expressions that are themselves bound to JSX `on*` attributes.
export const rerenderDeferReadsHook: Rule = {
  create: (context: RuleContext) => {
    const checkComponent = (componentBody: EsTreeNode | null | undefined): void => {
      if (!componentBody || componentBody.type !== "BlockStatement") return;
      const bindings = findHookCallBindings(componentBody);
      if (bindings.length === 0) return;
      const handlerBindingNames = collectHandlerBindingNames(componentBody);

      for (const binding of bindings) {
        const referenceLocations: EsTreeNode[] = [];
        walkAst(componentBody, (child: EsTreeNode) => {
          if (child === binding.declarator.id) return;
          if (child.type === "Identifier" && child.name === binding.valueName) {
            referenceLocations.push(child);
          }
        });

        if (referenceLocations.length === 0) continue;

        const allInHandlers = referenceLocations.every((ref) =>
          isInsideEventHandler(ref, handlerBindingNames),
        );
        if (!allInHandlers) continue;

        context.report({
          node: binding.declarator,
          message: `${binding.hookName}() return is only read inside event handlers — defer the read into the handler (e.g. \`new URL(window.location.href).searchParams\`) so the component doesn't re-render on every URL change`,
        });
      }
    };

    return {
      FunctionDeclaration(node: EsTreeNode) {
        if (!node.id?.name || !isUppercaseName(node.id.name)) return;
        checkComponent(node.body);
      },
      VariableDeclarator(node: EsTreeNode) {
        if (!isComponentAssignment(node)) return;
        checkComponent(node.init?.body);
      },
    };
  },
};

// HACK: walks the component AST while tracking which state names are
// SHADOWED in the current scope by a nested function's params or
// var/let/const declarations. Without this, a handler that locally
// re-binds the state name (e.g. `const items = raw.split(",")` then
// `items.push(x)`) gets falsely flagged. We don't do real scope
// analysis (would need eslint-utils' ScopeManager) — just lexical
// param + top-level binding collection per function, which covers the
// >99% of real-world shadowing cases without false positives.
const collectFunctionLocalBindings = (functionNode: EsTreeNode): Set<string> => {
  const localBindings = new Set<string>();
  for (const param of functionNode.params ?? []) {
    collectPatternNames(param, localBindings);
  }
  if (functionNode.body?.type === "BlockStatement") {
    for (const statement of functionNode.body.body ?? []) {
      if (statement.type !== "VariableDeclaration") continue;
      for (const declarator of statement.declarations ?? []) {
        collectPatternNames(declarator.id, localBindings);
      }
    }
  }
  return localBindings;
};

const isFunctionLikeNode = (node: EsTreeNode): boolean =>
  node.type === "FunctionDeclaration" ||
  node.type === "FunctionExpression" ||
  node.type === "ArrowFunctionExpression";

const walkComponentRespectingShadows = (
  node: EsTreeNode,
  shadowedStateNames: ReadonlySet<string>,
  visit: (child: EsTreeNode, currentlyShadowed: ReadonlySet<string>) => void,
): void => {
  if (!node || typeof node !== "object") return;

  let nextShadowedStateNames = shadowedStateNames;
  if (isFunctionLikeNode(node)) {
    const localBindings = collectFunctionLocalBindings(node);
    if (localBindings.size > 0) {
      const merged = new Set(shadowedStateNames);
      for (const localName of localBindings) merged.add(localName);
      nextShadowedStateNames = merged;
    }
  }

  visit(node, shadowedStateNames);

  for (const key of Object.keys(node)) {
    if (key === "parent") continue;
    const child = node[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        if (item && typeof item === "object" && item.type) {
          walkComponentRespectingShadows(item, nextShadowedStateNames, visit);
        }
      }
    } else if (child && typeof child === "object" && child.type) {
      walkComponentRespectingShadows(child, nextShadowedStateNames, visit);
    }
  }
};

export const noDirectStateMutation: Rule = {
  create: (context: RuleContext) => {
    const checkComponent = (componentBody: EsTreeNode | null | undefined): void => {
      if (!componentBody || componentBody.type !== "BlockStatement") return;
      const bindings = collectUseStateBindings(componentBody);
      if (bindings.length === 0) return;

      const stateValueToSetter = new Map<string, string>(
        bindings.map((binding) => [binding.valueName, binding.setterName] as const),
      );

      walkComponentRespectingShadows(
        componentBody,
        new Set(),
        (child: EsTreeNode, currentlyShadowed: ReadonlySet<string>) => {
          if (child.type === "AssignmentExpression") {
            if (child.left?.type !== "MemberExpression") return;
            const rootName = getRootIdentifierName(child.left);
            if (!rootName || !stateValueToSetter.has(rootName)) return;
            if (currentlyShadowed.has(rootName)) return;
            const setterName = stateValueToSetter.get(rootName);
            context.report({
              node: child,
              message: `Direct property assignment on useState value "${rootName}" — call ${setterName} with a new value; React only re-renders on a new reference`,
            });
            return;
          }

          if (child.type === "CallExpression") {
            const callee = child.callee;
            if (callee?.type !== "MemberExpression") return;
            if (callee.property?.type !== "Identifier") return;
            const methodName = callee.property.name;
            if (!MUTATING_ARRAY_METHODS.has(methodName)) return;
            const rootName = getRootIdentifierName(callee.object);
            if (!rootName || !stateValueToSetter.has(rootName)) return;
            if (currentlyShadowed.has(rootName)) return;
            const setterName = stateValueToSetter.get(rootName);
            context.report({
              node: child,
              message: `In-place mutation of useState value "${rootName}" via .${methodName}() — call ${setterName} with a new array; React only re-renders on a new reference`,
            });
          }
        },
      );
    };

    return {
      FunctionDeclaration(node: EsTreeNode) {
        if (!node.id?.name || !isUppercaseName(node.id.name)) return;
        checkComponent(node.body);
      },
      VariableDeclarator(node: EsTreeNode) {
        if (!isComponentAssignment(node)) return;
        checkComponent(node.init?.body);
      },
    };
  },
};

// HACK: an UNCONDITIONAL setter call at a component's render path
// triggers an infinite re-render loop ("Maximum update depth exceeded").
// We only flag the obvious shape — `setX(...)` as a top-level
// ExpressionStatement directly inside the component body — to avoid
// false positives on the canonical React pattern that conditionally
// updates state during render to derive from props (see
// https://react.dev/reference/react/useState#storing-information-from-previous-renders):
//
//   if (prevCount !== count) {
//     setPrevCount(count);  // ← legitimate, reaches a fixed point
//   }
//
// Conditional / loop / try-catch nesting is opaque enough that we'd
// rather miss the bug than scream at idiomatic code.
const isUnconditionalSetterCallStatement = (
  statement: EsTreeNode,
  setterNames: ReadonlySet<string>,
): EsTreeNode | null => {
  if (statement.type !== "ExpressionStatement") return null;
  const expression = statement.expression;
  if (expression?.type !== "CallExpression") return null;
  const callee = expression.callee;
  if (callee?.type !== "Identifier") return null;
  if (!setterNames.has(callee.name)) return null;
  return expression;
};

export const noSetStateInRender: Rule = {
  create: (context: RuleContext) => {
    const checkComponent = (componentBody: EsTreeNode | null | undefined): void => {
      if (!componentBody || componentBody.type !== "BlockStatement") return;
      const setterNames = new Set(
        collectUseStateBindings(componentBody).map((binding) => binding.setterName),
      );
      if (setterNames.size === 0) return;

      for (const statement of componentBody.body ?? []) {
        const setterCall = isUnconditionalSetterCallStatement(statement, setterNames);
        if (!setterCall) continue;
        const setterIdentifierName = setterCall.callee.name;
        context.report({
          node: setterCall,
          message: `${setterIdentifierName}() called unconditionally at the top of render — causes an infinite re-render loop. Move into a useEffect or an event handler. (To derive state from props, guard the call: \`if (prev !== prop) ${setterIdentifierName}(prop)\`)`,
        });
      }
    };

    return {
      FunctionDeclaration(node: EsTreeNode) {
        if (!node.id?.name || !isUppercaseName(node.id.name)) return;
        checkComponent(node.body);
      },
      VariableDeclarator(node: EsTreeNode) {
        if (!isComponentAssignment(node)) return;
        checkComponent(node.init?.body);
      },
    };
  },
};

// HACK: §11 of "You Might Not Need an Effect" + the linked
// `useSyncExternalStore` docs warn that pairing a `useState(getSnapshot())`
// with a `useEffect(() => store.subscribe(() => setSnapshot(getSnapshot())))`
// reimplements `useSyncExternalStore` in user space — incorrectly.
// The hand-rolled version doesn't support concurrent rendering,
// allows tearing during transitions, and lacks server-snapshot
// support during hydration.
//
// We require a four-vertex AST match before reporting:
//
//   (1) useEffect with empty deps                   `[]`
//   (2) body declares `const u = X.subscribe(handler)` OR
//       directly invokes a subscription method      X.addEventListener(...)
//   (3) cleanup is a `return` that either returns the unsubscribe
//       binding directly OR returns a closure that unsubscribes
//   (4) handler is a single `setY(<getter>)` whose `<getter>`
//       is structurally equal to the matching useState's initializer
//
// The combined match is so specific that real-world false positives
// are essentially impossible.
const findUseEffectsInComponent = (componentBody: EsTreeNode | undefined): EsTreeNode[] => {
  const effectCalls: EsTreeNode[] = [];
  if (componentBody?.type !== "BlockStatement") return effectCalls;
  for (const statement of componentBody.body ?? []) {
    walkAst(statement, (child: EsTreeNode) => {
      if (child.type === "CallExpression" && isHookCall(child, EFFECT_HOOK_NAMES)) {
        effectCalls.push(child);
      }
    });
  }
  return effectCalls;
};

const findSubscriptionCall = (
  effectBodyStatements: EsTreeNode[],
): { call: EsTreeNode; boundUnsubscribeName: string | null } | null => {
  for (const statement of effectBodyStatements) {
    if (statement.type === "VariableDeclaration") {
      for (const declarator of statement.declarations ?? []) {
        const init = declarator.init;
        if (init?.type !== "CallExpression") continue;
        if (init.callee?.type !== "MemberExpression") continue;
        if (init.callee.property?.type !== "Identifier") continue;
        if (!SUBSCRIPTION_METHOD_NAMES.has(init.callee.property.name)) continue;
        const boundUnsubscribeName =
          declarator.id?.type === "Identifier" ? declarator.id.name : null;
        return { call: init, boundUnsubscribeName };
      }
    }
    if (statement.type === "ExpressionStatement") {
      const expression = statement.expression;
      if (expression?.type !== "CallExpression") continue;
      if (expression.callee?.type !== "MemberExpression") continue;
      if (expression.callee.property?.type !== "Identifier") continue;
      if (!SUBSCRIPTION_METHOD_NAMES.has(expression.callee.property.name)) continue;
      return { call: expression, boundUnsubscribeName: null };
    }
  }
  return null;
};

// HACK: `window.addEventListener("online", onChange)` is the dominant
// real-world shape — the handler is declared as a separate `const` in
// the effect body so it can be shared with `removeEventListener` in the
// cleanup. We have to resolve the Identifier argument back to its
// locally-declared arrow/function init before the structural setter
// check can run.
const getSubscriptionHandlerArgument = (
  subscribeCall: EsTreeNode,
  effectBodyStatements: EsTreeNode[],
): EsTreeNode | null => {
  for (const argument of subscribeCall.arguments ?? []) {
    if (argument.type === "ArrowFunctionExpression" || argument.type === "FunctionExpression") {
      return argument;
    }
    if (argument.type === "Identifier") {
      for (const statement of effectBodyStatements) {
        if (statement.type !== "VariableDeclaration") continue;
        for (const declarator of statement.declarations ?? []) {
          if (declarator.id?.type !== "Identifier") continue;
          if (declarator.id.name !== argument.name) continue;
          const init = declarator.init;
          if (init?.type === "ArrowFunctionExpression" || init?.type === "FunctionExpression") {
            return init;
          }
        }
      }
    }
  }
  return null;
};

const getSingleSetterCallFromHandler = (
  handler: EsTreeNode,
): { setterName: string; setterArgument: EsTreeNode } | null => {
  const handlerStatements = getCallbackStatements(handler);
  if (handlerStatements.length !== 1) return null;
  const onlyStatement = handlerStatements[0];
  const expression =
    onlyStatement.type === "ExpressionStatement" ? onlyStatement.expression : onlyStatement;
  if (expression?.type !== "CallExpression") return null;
  if (expression.callee?.type !== "Identifier") return null;
  if (!isSetterIdentifier(expression.callee.name)) return null;
  if (!expression.arguments?.length) return null;
  return {
    setterName: expression.callee.name,
    setterArgument: expression.arguments[0],
  };
};

const cleanupReleasesSubscription = (
  effectBodyStatements: EsTreeNode[],
  boundUnsubscribeName: string | null,
): boolean => {
  const lastStatement = effectBodyStatements[effectBodyStatements.length - 1];
  if (lastStatement?.type !== "ReturnStatement") return false;
  const knownBoundReleaseNames = new Set<string>();
  if (boundUnsubscribeName) knownBoundReleaseNames.add(boundUnsubscribeName);
  return isCleanupReturn(lastStatement.argument, knownBoundReleaseNames);
};

export const preferUseSyncExternalStore: Rule = {
  create: (context: RuleContext) => {
    const checkComponent = (componentBody: EsTreeNode | null | undefined): void => {
      if (!componentBody || componentBody.type !== "BlockStatement") return;

      const useStateBindings = collectUseStateBindings(componentBody);
      if (useStateBindings.length === 0) return;

      const useStateInitializerByValueName = new Map<string, EsTreeNode>();
      for (const binding of useStateBindings) {
        const useStateCall = binding.declarator.init;
        const initializerArgument = useStateCall?.arguments?.[0];
        if (!initializerArgument) continue;
        // HACK: useState(() => getSnapshot()) — unwrap the lazy
        // initializer so the structural match against the
        // subscribe-handler's setter argument still resolves.
        if (
          (initializerArgument.type === "ArrowFunctionExpression" ||
            initializerArgument.type === "FunctionExpression") &&
          initializerArgument.body?.type !== "BlockStatement"
        ) {
          useStateInitializerByValueName.set(binding.valueName, initializerArgument.body);
        } else {
          useStateInitializerByValueName.set(binding.valueName, initializerArgument);
        }
      }

      const setterNameToValueName = new Map<string, string>();
      for (const binding of useStateBindings) {
        setterNameToValueName.set(binding.setterName, binding.valueName);
      }

      for (const effectCall of findUseEffectsInComponent(componentBody)) {
        if ((effectCall.arguments?.length ?? 0) < 2) continue;
        const depsNode = effectCall.arguments[1];
        if (depsNode.type !== "ArrayExpression") continue;
        if ((depsNode.elements?.length ?? 0) !== 0) continue;

        const callback = getEffectCallback(effectCall);
        if (!callback || callback.body?.type !== "BlockStatement") continue;
        const effectBodyStatements = callback.body.body ?? [];
        if (effectBodyStatements.length < 2) continue;

        const subscription = findSubscriptionCall(effectBodyStatements);
        if (!subscription) continue;

        const handler = getSubscriptionHandlerArgument(subscription.call, effectBodyStatements);
        if (!handler) continue;

        const setterPayload = getSingleSetterCallFromHandler(handler);
        if (!setterPayload) continue;

        const valueName = setterNameToValueName.get(setterPayload.setterName);
        if (!valueName) continue;

        const useStateInitializer = useStateInitializerByValueName.get(valueName);
        if (!useStateInitializer) continue;

        if (!areExpressionsStructurallyEqual(useStateInitializer, setterPayload.setterArgument)) {
          continue;
        }

        if (!cleanupReleasesSubscription(effectBodyStatements, subscription.boundUnsubscribeName)) {
          continue;
        }

        const matchingBinding = useStateBindings.find((binding) => binding.valueName === valueName);
        context.report({
          node: matchingBinding?.declarator ?? effectCall,
          message: `useState "${valueName}" is synchronized with an external store via useEffect — replace this useState + useEffect pair with useSyncExternalStore(subscribe, getSnapshot) to avoid tearing during concurrent renders`,
        });
      }
    };

    return {
      FunctionDeclaration(node: EsTreeNode) {
        if (!node.id?.name || !isUppercaseName(node.id.name)) return;
        checkComponent(node.body);
      },
      VariableDeclarator(node: EsTreeNode) {
        if (!isComponentAssignment(node)) return;
        checkComponent(node.init?.body);
      },
    };
  },
};

// HACK: §6 of "You Might Not Need an Effect" — sending a POST request:
//
//   const [jsonToSubmit, setJsonToSubmit] = useState(null);
//   useEffect(() => {
//     if (jsonToSubmit !== null) {
//       post('/api/register', jsonToSubmit);
//     }
//   }, [jsonToSubmit]);
//
//   function handleSubmit(event) {
//     event.preventDefault();
//     setJsonToSubmit({ firstName, lastName });   // ← only writer
//   }
//
// Detector pre-conditions (all must hold):
//   (1) useEffect with deps = [stateX] — single dep that's a useState
//       binding declared in this component
//   (2) effect body is a single IfStatement guarding on stateX with one
//       of: bare truthy, !== null/undefined, === Literal, or .length
//   (3) IfStatement.consequent contains a CallExpression whose callee
//       is in EVENT_TRIGGERED_SIDE_EFFECT_CALLEES OR a MemberExpression
//       whose property is in EVENT_TRIGGERED_SIDE_EFFECT_MEMBER_METHODS
//   (4) every setStateX call site is inside a JSX `on*` handler (or a
//       function bound to one) — i.e. the trigger is set only by user
//       interactions, never by other reactive logic
//
// Why all four matter: (1) + (2) recognize the "trigger guard" shape;
// (3) restricts to side effects users would associate with a button
// click; (4) is the strongest signal that the state exists *only* to
// schedule the effect, distinguishing this from §5 (event-shared logic
// triggered by props) which already has its own rule.
// HACK: in JS, `undefined` is parsed as an Identifier (not a Literal
// like `null`). For `x !== undefined`, both sides of the
// BinaryExpression are Identifiers, so a naive "first Identifier
// wins" pick can return `"undefined"` instead of the trigger state
// name — silently dropping the violation for the reversed
// (`undefined !== x`) ordering. Skip the `undefined` / `null`
// sentinel side so the actual state Identifier is what we return.
const SENTINEL_IDENTIFIER_NAMES = new Set(["undefined", "NaN", "null"]);

const isSentinelIdentifier = (node: EsTreeNode): boolean =>
  node?.type === "Identifier" && SENTINEL_IDENTIFIER_NAMES.has(node.name);

const getTriggerGuardRootName = (testNode: EsTreeNode): string | null => {
  if (!testNode) return null;
  if (testNode.type === "Identifier") return testNode.name;
  if (testNode.type === "BinaryExpression") {
    if (!["!==", "===", "!=", "=="].includes(testNode.operator)) return null;
    for (const side of [testNode.left, testNode.right]) {
      if (side?.type === "Identifier" && !isSentinelIdentifier(side)) {
        return side.name;
      }
    }
    return null;
  }
  if (
    testNode.type === "MemberExpression" &&
    testNode.property?.type === "Identifier" &&
    testNode.property.name === "length"
  ) {
    if (testNode.object?.type === "Identifier") return testNode.object.name;
  }
  if (testNode.type === "UnaryExpression" && testNode.operator === "!") {
    return getTriggerGuardRootName(testNode.argument);
  }
  return null;
};

const findTriggeredSideEffectCalleeName = (consequentNode: EsTreeNode): string | null => {
  let foundCalleeName: string | null = null;
  walkAst(consequentNode, (child: EsTreeNode) => {
    if (foundCalleeName) return false;
    if (child.type !== "CallExpression") return;
    const callee = child.callee;
    if (callee?.type === "Identifier" && EVENT_TRIGGERED_SIDE_EFFECT_CALLEES.has(callee.name)) {
      foundCalleeName = callee.name;
      return;
    }
    if (callee?.type === "MemberExpression" && callee.property?.type === "Identifier") {
      const propertyName = callee.property.name;
      const isUnambiguousMethod = EVENT_TRIGGERED_SIDE_EFFECT_MEMBER_METHODS.has(propertyName);
      const isNavigationMethod = EVENT_TRIGGERED_NAVIGATION_METHOD_NAMES.has(propertyName);
      if (!isUnambiguousMethod && !isNavigationMethod) return;
      const rootName = getRootIdentifierName(callee);
      if (isNavigationMethod && (rootName === null || !NAVIGATION_RECEIVER_NAMES.has(rootName))) {
        return;
      }
      foundCalleeName = rootName ? `${rootName}.${propertyName}` : propertyName;
    }
  });
  return foundCalleeName;
};

const collectHandlerOnlyWriteStateNames = (
  componentBody: EsTreeNode,
  useStateBindings: Array<{ valueName: string; setterName: string; declarator: EsTreeNode }>,
  handlerBindingNames: Set<string>,
): Set<string> => {
  const handlerOnlyWriteStateNames = new Set<string>();
  for (const binding of useStateBindings) {
    let didFindAnySetterCall = false;
    let areAllSetterCallsInHandlers = true;
    walkAst(componentBody, (child: EsTreeNode) => {
      if (!areAllSetterCallsInHandlers) return false;
      if (child.type !== "CallExpression") return;
      if (child.callee?.type !== "Identifier") return;
      if (child.callee.name !== binding.setterName) return;
      didFindAnySetterCall = true;
      if (!isInsideEventHandler(child, handlerBindingNames)) {
        areAllSetterCallsInHandlers = false;
      }
    });
    if (didFindAnySetterCall && areAllSetterCallsInHandlers) {
      handlerOnlyWriteStateNames.add(binding.valueName);
    }
  }
  return handlerOnlyWriteStateNames;
};

export const noEventTriggerState: Rule = {
  create: (context: RuleContext) => {
    const checkComponent = (componentBody: EsTreeNode | null | undefined): void => {
      if (!componentBody || componentBody.type !== "BlockStatement") return;

      const useStateBindings = collectUseStateBindings(componentBody);
      if (useStateBindings.length === 0) return;

      const handlerBindingNames = collectHandlerBindingNames(componentBody);
      const handlerOnlyWriteStateNames = collectHandlerOnlyWriteStateNames(
        componentBody,
        useStateBindings,
        handlerBindingNames,
      );
      if (handlerOnlyWriteStateNames.size === 0) return;

      // HACK: a state read in render (e.g. `<input value={query} />`)
      // is dual-purpose — it controls UI AND triggers the effect.
      // Calling it "exists only to schedule the effect" is wrong; the
      // user can't just delete the state. Reuse the same render-
      // reachability machinery that `rerenderStateOnlyInHandlers`
      // uses to filter these out (transitive dep graph + walk from
      // return expressions).
      const returnExpressions = collectReturnExpressions(componentBody);
      const dependencyGraph = buildLocalDependencyGraph(componentBody);
      const directRenderNames = collectRenderReachableNames(returnExpressions);
      const renderReachableNames = expandTransitiveDependencies(directRenderNames, dependencyGraph);

      walkAst(componentBody, (effectCall: EsTreeNode) => {
        if (effectCall.type !== "CallExpression") return;
        if (!isHookCall(effectCall, EFFECT_HOOK_NAMES)) return;
        if ((effectCall.arguments?.length ?? 0) < 2) return;

        const depsNode = effectCall.arguments[1];
        if (depsNode.type !== "ArrayExpression") return;
        if ((depsNode.elements?.length ?? 0) !== 1) return;

        const depElement = depsNode.elements[0];
        if (depElement?.type !== "Identifier") return;
        if (!handlerOnlyWriteStateNames.has(depElement.name)) return;
        // Dual-purpose state — used in render too. Don't claim it
        // "exists only to schedule" the effect.
        if (renderReachableNames.has(depElement.name)) return;

        const callback = getEffectCallback(effectCall);
        if (!callback) return;

        const bodyStatements = getCallbackStatements(callback);
        if (bodyStatements.length !== 1) return;
        const soleStatement = bodyStatements[0];
        if (soleStatement.type !== "IfStatement") return;

        const guardRootName = getTriggerGuardRootName(soleStatement.test);
        if (guardRootName !== depElement.name) return;

        const sideEffectCalleeName = findTriggeredSideEffectCalleeName(soleStatement.consequent);
        if (!sideEffectCalleeName) return;

        context.report({
          node: effectCall,
          message: `useState "${depElement.name}" exists only to schedule "${sideEffectCalleeName}(...)" from a useEffect — call "${sideEffectCalleeName}(...)" directly inside the event handler that sets it, and delete the state`,
        });
      });
    };

    return {
      FunctionDeclaration(node: EsTreeNode) {
        if (!node.id?.name || !isUppercaseName(node.id.name)) return;
        checkComponent(node.body);
      },
      VariableDeclarator(node: EsTreeNode) {
        if (!isComponentAssignment(node)) return;
        checkComponent(node.init?.body);
      },
    };
  },
};

// HACK: §7 of "You Might Not Need an Effect" — chains of computations:
//
//   useEffect(() => { if (card.gold) setGoldCardCount(c => c + 1); }, [card]);
//   useEffect(() => { if (goldCardCount > 3) setRound(r => r + 1); }, [goldCardCount]);
//   useEffect(() => { if (round > 5) setIsGameOver(true); }, [round]);
//
// Each link adds one extra render to the tree below the component.
// More importantly, the chain is rigid: setting `card` to a value from
// the past re-fires every downstream effect.
//
// `noCascadingSetState` (already shipped) catches multi-setter calls
// inside ONE effect; it does NOT see across effects. This rule
// complements it by detecting the cross-effect dependence.
//
// Detector (per component body):
//   1. Collect every top-level useEffect call and, for each:
//        - depNames: Identifier names in the dep array
//        - writtenStateNames: state names whose setter is called in the body
//        - isExternalSync: body returns cleanup OR contains a recognized
//          external-system call (subscribe / addEventListener / fetch /
//          setInterval / new MutationObserver / etc.) OR mutates a ref
//   2. For every ordered pair (A, B) of distinct effects:
//        edge iff (writes(A) ∩ deps(B)) ≠ ∅  AND  ¬isExternalSync(A)
//                                            AND  ¬isExternalSync(B)
//   3. Report on every effect B that is the target of any edge,
//      naming the chained state and the upstream effect's writer.
//
// The article calls out one legitimate "chain" — a multi-step network
// cascade where each effect re-fetches based on the previous step's
// result. Those effects all have `isExternalSync = true` because they
// contain `fetch`, so the rule won't fire.
const findTopLevelEffectCalls = (componentBody: EsTreeNode): EsTreeNode[] => {
  const effectCalls: EsTreeNode[] = [];
  if (componentBody?.type !== "BlockStatement") return effectCalls;
  for (const statement of componentBody.body ?? []) {
    if (statement.type !== "ExpressionStatement") continue;
    const expression = statement.expression;
    if (expression?.type !== "CallExpression") continue;
    if (!isHookCall(expression, EFFECT_HOOK_NAMES)) continue;
    effectCalls.push(expression);
  }
  return effectCalls;
};

const collectDepIdentifierNames = (effectNode: EsTreeNode): Set<string> => {
  const depNames = new Set<string>();
  const depsNode = effectNode.arguments?.[1];
  if (depsNode?.type !== "ArrayExpression") return depNames;
  for (const element of depsNode.elements ?? []) {
    if (element?.type === "Identifier") depNames.add(element.name);
  }
  return depNames;
};

// HACK: only count setter calls that actually run during the effect's
// synchronous body. A `setX` inside `setTimeout(() => setX(...))` or
// `.then(() => setX(...))` is a DEFERRED write — by the time it fires,
// the chain reader effect has already had its dep-update window. Treat
// only direct (non-nested-function) writes as chain triggers; that
// stops `noEffectChain` from over-flagging the dominant debounce /
// async-fetch shape that real codebases use.
const collectWrittenStateNamesInEffect = (
  effectCallback: EsTreeNode,
  setterToStateName: Map<string, string>,
): Set<string> => {
  const writtenStateNames = new Set<string>();
  walkInsideStatementBlocks(effectCallback.body, (child: EsTreeNode) => {
    if (child.type !== "CallExpression") return;
    if (child.callee?.type !== "Identifier") return;
    const stateName = setterToStateName.get(child.callee.name);
    if (stateName) writtenStateNames.add(stateName);
  });
  return writtenStateNames;
};

// HACK: a useEffect cleanup return value MUST be a function (or
// undefined). Anything else is either user error or "I'm using
// `return` for early-exit, not for cleanup". For the chain detector,
// we treat only function-shaped returns as "this effect owns an
// external resource" — bare literals (`return null`, `return 0`) and
// state reads (`return foo`) get ignored so they don't silently
// disable chain detection.
const isFunctionShapedReturn = (returnedValue: EsTreeNode): boolean => {
  if (
    returnedValue.type === "ArrowFunctionExpression" ||
    returnedValue.type === "FunctionExpression"
  ) {
    return true;
  }
  // Returning a CallExpression result — most cleanup-returning
  // primitives (subscribe, addEventListener helpers) return a
  // function. Conservatively accept this shape.
  if (returnedValue.type === "CallExpression") return true;
  // Returning a bare Identifier — could be the unsub binding from a
  // `const unsub = subscribe(...)` line. We can't statically prove
  // it's function-typed without scope analysis, but in idiomatic React
  // this is the dominant cleanup pattern. Accept.
  if (returnedValue.type === "Identifier") return true;
  return false;
};

const isExternalSyncEffect = (effectCallback: EsTreeNode): boolean => {
  // A cleanup return is the strongest signal that the effect owns
  // an external resource — once we see one, we don't need to inspect
  // the body for an external-sync call shape.
  if (effectCallback.body?.type === "BlockStatement") {
    const statements = effectCallback.body.body ?? [];
    for (const statement of statements) {
      if (
        statement.type === "ReturnStatement" &&
        statement.argument &&
        isFunctionShapedReturn(statement.argument)
      ) {
        return true;
      }
    }
  }

  let didFindExternalCall = false;
  walkAst(effectCallback, (child: EsTreeNode) => {
    if (didFindExternalCall) return false;

    if (child.type === "NewExpression") {
      const constructor = child.callee;
      if (
        constructor?.type === "Identifier" &&
        EXTERNAL_SYNC_OBSERVER_CONSTRUCTORS.has(constructor.name)
      ) {
        didFindExternalCall = true;
      }
      return;
    }

    if (child.type === "AssignmentExpression") {
      if (
        child.left?.type === "MemberExpression" &&
        child.left.property?.type === "Identifier" &&
        child.left.property.name === "current"
      ) {
        didFindExternalCall = true;
      }
      return;
    }

    if (child.type !== "CallExpression") return;

    if (
      child.callee?.type === "Identifier" &&
      EXTERNAL_SYNC_DIRECT_CALLEE_NAMES.has(child.callee.name)
    ) {
      didFindExternalCall = true;
      return;
    }

    if (child.callee?.type === "MemberExpression" && child.callee.property?.type === "Identifier") {
      const propertyName = child.callee.property.name;
      if (EXTERNAL_SYNC_MEMBER_METHOD_NAMES.has(propertyName)) {
        didFindExternalCall = true;
        return;
      }
      // HACK: `get` / `head` / `options` are HTTP verbs but also names
      // of universal data-structure methods (Map.get, URLSearchParams.get,
      // etc.). Only count them when the receiver looks like an HTTP
      // client.
      if (EXTERNAL_SYNC_AMBIGUOUS_HTTP_METHOD_NAMES.has(propertyName)) {
        const receiverRootName = getRootIdentifierName(child.callee.object);
        if (
          receiverRootName !== null &&
          EXTERNAL_SYNC_HTTP_CLIENT_RECEIVERS.has(receiverRootName)
        ) {
          didFindExternalCall = true;
        }
      }
    }
  });

  return didFindExternalCall;
};

interface EffectInfo {
  node: EsTreeNode;
  depNames: Set<string>;
  writtenStateNames: Set<string>;
  isExternalSync: boolean;
}

export const noEffectChain: Rule = {
  create: (context: RuleContext) => {
    const checkComponent = (componentBody: EsTreeNode | null | undefined): void => {
      if (!componentBody || componentBody.type !== "BlockStatement") return;

      const useStateBindings = collectUseStateBindings(componentBody);
      if (useStateBindings.length === 0) return;
      const setterToStateName = new Map<string, string>();
      for (const binding of useStateBindings) {
        setterToStateName.set(binding.setterName, binding.valueName);
      }

      const effectInfos: EffectInfo[] = [];
      for (const effectCall of findTopLevelEffectCalls(componentBody)) {
        const callback = getEffectCallback(effectCall);
        if (!callback) continue;
        effectInfos.push({
          node: effectCall,
          depNames: collectDepIdentifierNames(effectCall),
          writtenStateNames: collectWrittenStateNamesInEffect(callback, setterToStateName),
          isExternalSync: isExternalSyncEffect(callback),
        });
      }
      if (effectInfos.length < 2) return;

      const reportedNodes = new Set<EsTreeNode>();
      for (const writerEffect of effectInfos) {
        if (writerEffect.isExternalSync) continue;
        if (writerEffect.writtenStateNames.size === 0) continue;
        for (const readerEffect of effectInfos) {
          if (readerEffect === writerEffect) continue;
          if (readerEffect.isExternalSync) continue;
          if (readerEffect.depNames.size === 0) continue;

          let chainedStateName: string | null = null;
          for (const writtenName of writerEffect.writtenStateNames) {
            if (readerEffect.depNames.has(writtenName)) {
              chainedStateName = writtenName;
              break;
            }
          }
          if (!chainedStateName) continue;
          if (reportedNodes.has(readerEffect.node)) continue;
          reportedNodes.add(readerEffect.node);

          context.report({
            node: readerEffect.node,
            message: `useEffect reacts to "${chainedStateName}" which is set by another useEffect — chains of effects add an extra render per link and become rigid as code evolves. Compute what you can during render and write all related state inside the event handler that originally fires the chain`,
          });
        }
      }
    };

    return {
      FunctionDeclaration(node: EsTreeNode) {
        if (!node.id?.name || !isUppercaseName(node.id.name)) return;
        checkComponent(node.body);
      },
      VariableDeclarator(node: EsTreeNode) {
        if (!isComponentAssignment(node)) return;
        checkComponent(node.init?.body);
      },
    };
  },
};

// HACK: "Lifecycle of Reactive Effects" — Can global or mutable
// values be dependencies? — calls out that `location.pathname`,
// `ref.current`, and other mutable values can't be deps:
//
//   "Mutable values aren't reactive. Changing it wouldn't trigger
//    a re-render, so even if you specified it in the dependencies,
//    React wouldn't know to re-synchronize the Effect."
//
// We flag two shapes:
//   (1) MemberExpression rooted in a known mutable global
//       (location, window, document, navigator, history, ...) —
//       e.g. `location.pathname`, `window.innerWidth`, `document.title`
//   (2) MemberExpression `<x>.current` where `x` is a `useRef`
//       binding declared in the same component
//
// Bare `location` / bare `useRef`-returned identifiers are NOT
// flagged — those are themselves stable references; only their
// mutable property reads are the bug.
const collectUseRefBindingNames = (componentBody: EsTreeNode): Set<string> => {
  const useRefBindings = new Set<string>();
  if (componentBody?.type !== "BlockStatement") return useRefBindings;
  for (const statement of componentBody.body ?? []) {
    if (statement.type !== "VariableDeclaration") continue;
    for (const declarator of statement.declarations ?? []) {
      if (declarator.id?.type !== "Identifier") continue;
      if (declarator.init?.type !== "CallExpression") continue;
      if (!isHookCall(declarator.init, "useRef")) continue;
      useRefBindings.add(declarator.id.name);
    }
  }
  return useRefBindings;
};

const findMutableDepIssue = (
  depElement: EsTreeNode,
  useRefBindingNames: Set<string>,
): { kind: "global" | "ref-current"; rootName: string } | null => {
  if (depElement.type !== "MemberExpression") return null;

  if (
    depElement.property?.type === "Identifier" &&
    depElement.property.name === "current" &&
    !depElement.computed &&
    depElement.object?.type === "Identifier" &&
    useRefBindingNames.has(depElement.object.name)
  ) {
    return { kind: "ref-current", rootName: depElement.object.name };
  }

  const rootName = getRootIdentifierName(depElement);
  if (rootName !== null && MUTABLE_GLOBAL_ROOTS.has(rootName)) {
    return { kind: "global", rootName };
  }
  return null;
};

// HACK: §1 of "You Might Not Need an Effect" — mirroring a prop into
// local state with a useEffect that re-syncs it. The combined shape
// is the most common form of derived-state-effect in real codebases:
//
//   function Form({ value }) {
//     const [draft, setDraft] = useState(value);
//     useEffect(() => { setDraft(value); }, [value]);
//     // ...
//   }
//
// Both `noDerivedStateEffect` and `noDerivedUseState` independently
// nudge at parts of this. This rule produces a single, more
// actionable diagnostic that names the prop and recommends deleting
// both the useState and the effect.
//
// Detector pre-conditions:
//   (1) `[X, setX] = useState(<propExpr>)` where <propExpr> is a
//       prop Identifier or a MemberExpression rooted in a prop
//   (2) `useEffect(() => setX(<propExpr'>), [<propRoot>])` where
//       <propExpr'> is structurally identical to <propExpr> from (1)
// Follow call chains so a prop-rooted method call counts:
// `useState(value.toUpperCase())` resolves to root "value". Safe for
// mirror-detection because the structural-equality check on the setter
// argument still requires the SAME call shape — it won't match
// `setX(value.toLowerCase())`.
const getPropRootName = (
  expression: EsTreeNode | null | undefined,
  propNames: Set<string>,
): string | null => {
  const rootName = getRootIdentifierName(expression, { followCallChains: true });
  return rootName !== null && propNames.has(rootName) ? rootName : null;
};

interface MirrorBinding {
  valueName: string;
  setterName: string;
  initializer: EsTreeNode;
  propRootName: string;
}

// HACK: From "Lifecycle of Reactive Effects":
//
//   "Each Effect describes a separate synchronization process. When
//    the component is removed, your Effect needs to stop synchronizing.
//    The cleanup function should stop or undo whatever the Effect was
//    doing."
//
// An effect that adds a listener / subscribes / sets a timer but
// returns no cleanup leaks memory and triggers React's "you forgot
// to clean up an effect" StrictMode hint at runtime. We flag it
// statically. Three subscribe-shaped families:
//   - addEventListener (browser DOM, EventTarget-shaped libs)
//   - subscribe / addListener / on / watch / listen / sub
//   - setInterval / setTimeout (without explicit clear)
//
// The subscribe / unsubscribe method allowlists live in `constants.ts`
// (`SUBSCRIPTION_METHOD_NAMES`, `UNSUBSCRIPTION_METHOD_NAMES`) so the
// cleanup-needed detector and the prefer-use-sync-external-store
// detector share a single source of truth. Inline duplicates would
// silently drift out of sync as new library shapes get added.

interface SubscribeLikeUsage {
  kind: "subscribe" | "timer";
  resourceName: string;
}

const findSubscribeLikeUsages = (callback: EsTreeNode): SubscribeLikeUsage[] => {
  const usages: SubscribeLikeUsage[] = [];
  // HACK: timer/subscribe calls inside the EFFECT'S CLEANUP RETURN
  // are not new registrations — they're the disposal step. The old
  // walker traversed the full callback including any returned
  // cleanup function, so a `setTimeout` inside `return () => { ... }`
  // got counted as a usage. Detect and skip the cleanup ReturnStatement's
  // argument body during the walk.
  let cleanupArgument: EsTreeNode | null = null;
  if (callback.body?.type === "BlockStatement") {
    const callbackStatements = callback.body.body ?? [];
    const lastCallbackStatement = callbackStatements[callbackStatements.length - 1];
    if (lastCallbackStatement?.type === "ReturnStatement" && lastCallbackStatement.argument) {
      cleanupArgument = lastCallbackStatement.argument;
    }
  }

  walkAst(callback, (child: EsTreeNode) => {
    if (child === cleanupArgument) return false;
    if (child.type !== "CallExpression") return;

    if (
      child.callee?.type === "Identifier" &&
      TIMER_CALLEE_NAMES_REQUIRING_CLEANUP.has(child.callee.name)
    ) {
      usages.push({
        kind: "timer",
        resourceName: child.callee.name,
      });
      return;
    }

    if (
      child.callee?.type === "MemberExpression" &&
      child.callee.property?.type === "Identifier" &&
      SUBSCRIPTION_METHOD_NAMES.has(child.callee.property.name)
    ) {
      usages.push({
        kind: "subscribe",
        resourceName: child.callee.property.name,
      });
    }
  });
  return usages;
};

const isSubscribeLikeCallExpression = (node: EsTreeNode): boolean => {
  if (node?.type !== "CallExpression") return false;
  if (node.callee?.type !== "MemberExpression") return false;
  if (node.callee.property?.type !== "Identifier") return false;
  return SUBSCRIPTION_METHOD_NAMES.has(node.callee.property.name);
};

// HACK: variables bound to a subscribe-like or timer-like call inside
// an effect body are CLEANUP TARGETS — `return X` or `() => X()` /
// `() => clearTimeout(X)` releases the resource. Collecting them here
// lets the shared release predicate accept user-named bindings
// (`const unsub = ...; return unsub`) without falling back to the
// previous "any Identifier is fine" behavior.
const collectReleasableBindingNames = (effectCallback: EsTreeNode): Set<string> => {
  const releasableNames = new Set<string>();
  if (effectCallback.body?.type !== "BlockStatement") return releasableNames;
  for (const statement of effectCallback.body.body ?? []) {
    if (statement.type !== "VariableDeclaration") continue;
    for (const declarator of statement.declarations ?? []) {
      if (declarator.id?.type !== "Identifier") continue;
      const init = declarator.init;
      if (!init || init.type !== "CallExpression") continue;
      if (isSubscribeLikeCallExpression(init)) {
        releasableNames.add(declarator.id.name);
        continue;
      }
      if (
        init.callee?.type === "Identifier" &&
        TIMER_CALLEE_NAMES_REQUIRING_CLEANUP.has(init.callee.name)
      ) {
        releasableNames.add(declarator.id.name);
      }
    }
  }
  return releasableNames;
};

// Single source of truth for "does this CallExpression release a
// previously-acquired effect resource?". Used by both
// `effectNeedsCleanup` and `prefer-use-sync-external-store` so the
// two rules can never disagree on what a cleanup looks like.
const isReleaseLikeCall = (
  callNode: EsTreeNode,
  knownBoundReleaseNames: ReadonlySet<string>,
): boolean => {
  if (callNode?.type !== "CallExpression") return false;
  const callee = callNode.callee;
  if (callee?.type === "Identifier") {
    if (TIMER_CLEANUP_CALLEE_NAMES.has(callee.name)) return true;
    if (CLEANUP_LIKE_RELEASE_CALLEE_NAMES.has(callee.name)) return true;
    if (knownBoundReleaseNames.has(callee.name)) return true;
    return false;
  }
  if (callee?.type === "MemberExpression" && callee.property?.type === "Identifier") {
    return UNSUBSCRIPTION_METHOD_NAMES.has(callee.property.name);
  }
  return false;
};

const containsReleaseLikeCall = (
  node: EsTreeNode,
  knownBoundReleaseNames: ReadonlySet<string>,
): boolean => {
  let didFindRelease = false;
  walkAst(node, (child: EsTreeNode) => {
    if (didFindRelease) return false;
    if (isReleaseLikeCall(child, knownBoundReleaseNames)) {
      didFindRelease = true;
      return false;
    }
  });
  return didFindRelease;
};

// Recognizes the four cleanup-return shapes uniformly:
//   return unsub                              → bound name match
//   return store.subscribe(handler)           → subscribe call IS the unsub
//   return () => unsub()                      → closure releases via name
//   return () => store.removeListener(...)    → closure releases via verb
const isCleanupReturn = (
  returnedValue: EsTreeNode | null | undefined,
  knownBoundReleaseNames: ReadonlySet<string>,
): boolean => {
  if (!returnedValue) return false;
  if (returnedValue.type === "Identifier") {
    return knownBoundReleaseNames.has(returnedValue.name);
  }
  if (isSubscribeLikeCallExpression(returnedValue)) return true;
  if (
    returnedValue.type === "ArrowFunctionExpression" ||
    returnedValue.type === "FunctionExpression"
  ) {
    return containsReleaseLikeCall(returnedValue, knownBoundReleaseNames);
  }
  return false;
};

const effectHasCleanupRelease = (callback: EsTreeNode): boolean => {
  // HACK: expression-body arrows are the dominant shape for trivial
  // subscribe-only effects:
  //
  //   useEffect(() => store.subscribe(handler), []);
  //
  // The arrow's expression body IS the body, and its evaluation
  // result is implicitly returned as the effect's cleanup function.
  // For subscribe-shaped calls we know the return value is the
  // unsubscribe — accept this case before the BlockStatement-only
  // checks below.
  if (callback.body?.type !== "BlockStatement") {
    return isSubscribeLikeCallExpression(callback.body);
  }
  const statements = callback.body.body ?? [];
  const lastStatement = statements[statements.length - 1];
  if (lastStatement?.type !== "ReturnStatement") return false;
  const knownBoundReleaseNames = collectReleasableBindingNames(callback);
  return isCleanupReturn(lastStatement.argument, knownBoundReleaseNames);
};

export const effectNeedsCleanup: Rule = {
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNode) {
      if (!isHookCall(node, EFFECT_HOOK_NAMES)) return;
      const callback = getEffectCallback(node);
      if (!callback) return;

      const usages = findSubscribeLikeUsages(callback);
      if (usages.length === 0) return;

      if (effectHasCleanupRelease(callback)) return;

      const firstUsage = usages[0];
      const verb = firstUsage.kind === "timer" ? "schedules" : "subscribes via";
      const release =
        firstUsage.kind === "timer"
          ? `clear${firstUsage.resourceName === "setInterval" ? "Interval" : "Timeout"}(...)`
          : "the matching remove/unsubscribe call";
      context.report({
        node,
        message: `useEffect ${verb} \`${firstUsage.resourceName}(...)\` but never returns a cleanup — leaks the registration on every re-run and on unmount. Return a cleanup function that calls ${release}`,
      });
    },
  }),
};

export const noMirrorPropEffect: Rule = {
  create: (context: RuleContext) => {
    const checkComponent = (componentBody: EsTreeNode | undefined): void => {
      if (!componentBody || componentBody.type !== "BlockStatement") return;
      const propNames = propStackTracker.getCurrentPropNames();
      if (propNames.size === 0) return;

      const mirrorBindings: MirrorBinding[] = [];

      for (const statement of componentBody.body ?? []) {
        if (statement.type !== "VariableDeclaration") continue;
        for (const declarator of statement.declarations ?? []) {
          if (declarator.id?.type !== "ArrayPattern") continue;
          const elements = declarator.id.elements ?? [];
          if (elements.length < 2) continue;
          const valueElement = elements[0];
          const setterElement = elements[1];
          if (
            valueElement?.type !== "Identifier" ||
            setterElement?.type !== "Identifier" ||
            !isSetterIdentifier(setterElement.name)
          ) {
            continue;
          }
          if (declarator.init?.type !== "CallExpression") continue;
          if (!isHookCall(declarator.init, "useState")) continue;
          const initializer = declarator.init.arguments?.[0];
          if (!initializer) continue;
          const propRootName = getPropRootName(initializer, propNames);
          if (!propRootName) continue;
          mirrorBindings.push({
            valueName: valueElement.name,
            setterName: setterElement.name,
            initializer,
            propRootName,
          });
        }
      }

      if (mirrorBindings.length === 0) return;

      // HACK: only consider useEffects that are direct top-level
      // statements of the component body. A useEffect inside a nested
      // helper is a rules-of-hooks violation and isn't part of this
      // component's surface — its outer prop set wouldn't apply
      // anyway.
      for (const statement of componentBody.body ?? []) {
        if (statement.type !== "ExpressionStatement") continue;
        const effectCall = statement.expression;
        if (effectCall?.type !== "CallExpression") continue;
        if (!isHookCall(effectCall, EFFECT_HOOK_NAMES)) continue;
        if ((effectCall.arguments?.length ?? 0) < 2) continue;

        const depsNode = effectCall.arguments[1];
        if (depsNode.type !== "ArrayExpression") continue;
        // HACK: previously required EXACTLY one dep, which silently
        // missed the legitimate `useEffect(() => setX(value), [value, otherDep])`
        // mirror shape. Now we accept any deps array as long as the
        // prop root we mirror IS one of the deps — `otherDep` being
        // unused inside the body is a separate (exhaustive-deps) concern.
        const depIdentifierNames = new Set<string>();
        for (const element of depsNode.elements ?? []) {
          if (element?.type === "Identifier") depIdentifierNames.add(element.name);
        }
        if (depIdentifierNames.size === 0) continue;

        const callback = getEffectCallback(effectCall);
        if (!callback) continue;
        const bodyStatements = getCallbackStatements(callback);
        if (bodyStatements.length !== 1) continue;
        const onlyStatement = bodyStatements[0];
        const expression =
          onlyStatement.type === "ExpressionStatement" ? onlyStatement.expression : onlyStatement;
        if (expression?.type !== "CallExpression") continue;
        if (expression.callee?.type !== "Identifier") continue;
        if (!isSetterIdentifier(expression.callee.name)) continue;
        if (!expression.arguments?.length) continue;
        const setterArgument = expression.arguments[0];

        const matchedBinding = mirrorBindings.find(
          (binding) =>
            binding.setterName === expression.callee.name &&
            depIdentifierNames.has(binding.propRootName) &&
            areExpressionsStructurallyEqual(binding.initializer, setterArgument),
        );
        if (!matchedBinding) continue;

        context.report({
          node: effectCall,
          message: `useState "${matchedBinding.valueName}" is mirrored from prop "${matchedBinding.propRootName}" via this effect — delete both the useState and the effect, and read the prop directly in render`,
        });
      }
    };

    const propStackTracker = createComponentPropStackTracker({
      onComponentEnter: checkComponent,
    });

    return propStackTracker.visitors;
  },
};

export const noMutableInDeps: Rule = {
  create: (context: RuleContext) => {
    const checkComponent = (componentBody: EsTreeNode | null | undefined): void => {
      if (!componentBody || componentBody.type !== "BlockStatement") return;
      const useRefBindingNames = collectUseRefBindingNames(componentBody);

      walkAst(componentBody, (child: EsTreeNode) => {
        if (child.type !== "CallExpression") return;
        if (!isHookCall(child, HOOKS_WITH_DEPS)) return;
        if ((child.arguments?.length ?? 0) < 2) return;
        const depsNode = child.arguments[1];
        if (depsNode.type !== "ArrayExpression") return;

        for (const element of depsNode.elements ?? []) {
          if (!element) continue;
          const issue = findMutableDepIssue(element, useRefBindingNames);
          if (!issue) continue;
          if (issue.kind === "ref-current") {
            context.report({
              node: element,
              message: `"${issue.rootName}.current" in deps — refs are mutable and don't trigger re-renders, so React won't re-run this effect when it changes. Read the ref inside the effect body instead`,
            });
          } else {
            context.report({
              node: element,
              message: `Mutable global "${issue.rootName}.*" in deps — values like \`location.pathname\` can change without triggering a re-render, so they can't drive effect re-runs. Subscribe with useSyncExternalStore or read inside the effect`,
            });
          }
        }
      });
    };

    return {
      FunctionDeclaration(node: EsTreeNode) {
        if (!node.id?.name || !isUppercaseName(node.id.name)) return;
        checkComponent(node.body);
      },
      VariableDeclarator(node: EsTreeNode) {
        if (!isComponentAssignment(node)) return;
        checkComponent(node.init?.body);
      },
    };
  },
};

// HACK: From "Separating Events from Effects" — when a function-typed
// prop (or local callback) is read from an effect ONLY inside a sub-
// handler (setTimeout / addEventListener / store.subscribe / etc.),
// listing it in the dep array forces the whole effect to re-synchronize
// every time its identity changes. The article's recommended fix is
// `useEffectEvent`, which is React 19+. The rule is registered as
// version-gated in `oxlint-config.ts` (USE_EFFECT_EVENT_MIN_MAJOR) so
// pre-19 projects don't see noisy diagnostics for an API they don't
// have.
//
//   function SearchInput({ onSearch }) {
//     const [query, setQuery] = useState('');
//     useEffect(() => {
//       const id = setTimeout(() => onSearch(query), 300);  // sub-handler
//       return () => clearTimeout(id);
//     }, [query, onSearch]);
//   }
//
// Detector pre-conditions (all must hold) — chosen to keep FPs near zero:
//   (1) useEffect with at least 2 dep array elements, all Identifiers
//   (2) at least one dep `F` is a function-shaped reactive value:
//         - a destructured prop named `on[A-Z]…`, OR
//         - a local declared via `const F = useCallback(...)`
//   (3) every read of `F` inside the effect body sits inside a sub-
//       handler (TIMER_AND_SCHEDULER_DIRECT_CALLEE_NAMES, OR a
//       MemberExpression whose property is in SUBSCRIPTION_METHOD_NAMES
//       — same set the prefer-use-sync-external-store family uses)
//   (4) `F` is NEVER read at the effect's own top level
const collectFunctionTypedLocalBindings = (componentBody: EsTreeNode): Set<string> => {
  const functionTypedLocals = new Set<string>();
  if (componentBody?.type !== "BlockStatement") return functionTypedLocals;
  for (const statement of componentBody.body ?? []) {
    if (statement.type !== "VariableDeclaration") continue;
    for (const declarator of statement.declarations ?? []) {
      if (declarator.id?.type !== "Identifier") continue;
      if (declarator.init?.type !== "CallExpression") continue;
      if (!isHookCall(declarator.init, "useCallback")) continue;
      functionTypedLocals.add(declarator.id.name);
    }
  }
  return functionTypedLocals;
};

const findEnclosingFunctionInsideEffect = (
  identifierNode: EsTreeNode,
  effectCallback: EsTreeNode,
): EsTreeNode | null => {
  let cursor: EsTreeNode | null = identifierNode.parent ?? null;
  while (cursor && cursor !== effectCallback) {
    if (
      cursor.type === "ArrowFunctionExpression" ||
      cursor.type === "FunctionExpression" ||
      cursor.type === "FunctionDeclaration"
    ) {
      return cursor;
    }
    cursor = cursor.parent ?? null;
  }
  return null;
};

const isCallExpressionWithSubHandlerCallee = (callExpression: EsTreeNode): boolean => {
  if (callExpression?.type !== "CallExpression") return false;
  const callee = callExpression.callee;
  if (callee?.type === "Identifier" && TIMER_AND_SCHEDULER_DIRECT_CALLEE_NAMES.has(callee.name)) {
    return true;
  }
  if (
    callee?.type === "MemberExpression" &&
    callee.property?.type === "Identifier" &&
    SUBSCRIPTION_METHOD_NAMES.has(callee.property.name)
  ) {
    return true;
  }
  return false;
};

const getSubHandlerCalleeName = (callExpression: EsTreeNode): string | null => {
  if (callExpression?.type !== "CallExpression") return null;
  const callee = callExpression.callee;
  if (callee?.type === "Identifier") return callee.name;
  if (callee?.type === "MemberExpression" && callee.property?.type === "Identifier") {
    return callee.property.name;
  }
  return null;
};

// HACK: handles the dominant real-world shape where the handler is
// bound to a const before being passed to addEventListener / subscribe:
//
//   const handler = (event) => onKey(event.key);
//   window.addEventListener('keydown', handler);
//   return () => window.removeEventListener('keydown', handler);
//
// Walks up to the function-level node (the arrow expression) and checks
// for either a direct sub-handler argument position OR a const binding
// whose Identifier appears as an argument to a sub-handler call later
// in the same effect body.
// Resolve the enclosing function back to its local-binding name across
// the three idiomatic shapes:
//   const handler = (e) => ...      → VariableDeclarator binding
//   function handler(e) { ... }     → FunctionDeclaration self-binding
//   let handler; handler = (e) => ... → AssignmentExpression binding
const getEnclosingFunctionBindingName = (enclosingFunction: EsTreeNode): string | null => {
  if (
    enclosingFunction.type === "FunctionDeclaration" &&
    enclosingFunction.id?.type === "Identifier"
  ) {
    return enclosingFunction.id.name;
  }
  const directParent = enclosingFunction.parent;
  if (directParent?.type === "VariableDeclarator" && directParent.id?.type === "Identifier") {
    return directParent.id.name;
  }
  if (
    directParent?.type === "AssignmentExpression" &&
    directParent.right === enclosingFunction &&
    directParent.left?.type === "Identifier"
  ) {
    return directParent.left.name;
  }
  return null;
};

const findSubHandlerForEnclosingFunction = (
  enclosingFunction: EsTreeNode,
  effectCallback: EsTreeNode,
): EsTreeNode | null => {
  const directParent = enclosingFunction.parent;
  if (
    directParent?.type === "CallExpression" &&
    directParent.arguments?.includes(enclosingFunction) &&
    isCallExpressionWithSubHandlerCallee(directParent)
  ) {
    return directParent;
  }

  const localName = getEnclosingFunctionBindingName(enclosingFunction);
  if (localName === null) return null;

  let matchingSubHandlerCall: EsTreeNode | null = null;
  walkAst(effectCallback, (child: EsTreeNode) => {
    if (matchingSubHandlerCall) return false;
    if (child.type !== "CallExpression") return;
    if (!isCallExpressionWithSubHandlerCallee(child)) return;
    for (const argument of child.arguments ?? []) {
      if (argument?.type === "Identifier" && argument.name === localName) {
        matchingSubHandlerCall = child;
        return false;
      }
    }
  });
  return matchingSubHandlerCall;
};

interface CallableReadClassification {
  hasAnyRead: boolean;
  allReadsAreInSubHandlers: boolean;
  firstSubHandlerName: string | null;
}

const classifyCallableReadsInsideEffect = (
  callableName: string,
  effectCallback: EsTreeNode,
): CallableReadClassification => {
  let hasAnyRead = false;
  let allReadsAreInSubHandlers = true;
  let firstSubHandlerName: string | null = null;

  walkAst(effectCallback, (child: EsTreeNode) => {
    if (child.type !== "Identifier") return;
    if (child.name !== callableName) return;
    const parent = child.parent;
    if (parent?.type === "ArrayExpression") return;
    if (parent?.type === "MemberExpression" && !parent.computed && parent.property === child) {
      return;
    }
    if (
      parent?.type === "Property" &&
      !parent.computed &&
      !parent.shorthand &&
      parent.key === child
    ) {
      return;
    }

    hasAnyRead = true;

    const enclosingFunction = findEnclosingFunctionInsideEffect(child, effectCallback);
    if (!enclosingFunction) {
      allReadsAreInSubHandlers = false;
      return;
    }
    const subHandlerCall = findSubHandlerForEnclosingFunction(enclosingFunction, effectCallback);
    if (!subHandlerCall) {
      allReadsAreInSubHandlers = false;
      return;
    }
    if (firstSubHandlerName === null) {
      firstSubHandlerName = getSubHandlerCalleeName(subHandlerCall);
    }
  });

  return { hasAnyRead, allReadsAreInSubHandlers, firstSubHandlerName };
};

export const preferUseEffectEvent: Rule = {
  create: (context: RuleContext) => {
    const checkComponent = (componentBody: EsTreeNode | undefined): void => {
      if (!componentBody || componentBody.type !== "BlockStatement") return;
      const functionTypedLocalBindings = collectFunctionTypedLocalBindings(componentBody);

      for (const statement of componentBody.body ?? []) {
        if (statement.type !== "ExpressionStatement") continue;
        const effectCall = statement.expression;
        if (effectCall?.type !== "CallExpression") continue;
        if (!isHookCall(effectCall, EFFECT_HOOK_NAMES)) continue;
        if ((effectCall.arguments?.length ?? 0) < 2) continue;

        const depsNode = effectCall.arguments[1];
        if (depsNode.type !== "ArrayExpression") continue;
        const depElements = depsNode.elements ?? [];
        if (depElements.length < 2) continue;
        if (!depElements.every((element: EsTreeNode | null) => element?.type === "Identifier")) {
          continue;
        }

        const callback = getEffectCallback(effectCall);
        if (!callback) continue;

        for (const depElement of depElements) {
          if (!depElement) continue;
          const depName: string = depElement.name;
          // HACK: a destructured prop is treated as function-typed
          // ONLY if its name matches the React `on[A-Z]` callback
          // convention. Without this filter the rule false-positived
          // on scalar props.
          const isFunctionTypedPropDep =
            propStackTracker.isPropName(depName) && REACT_HANDLER_PROP_PATTERN.test(depName);
          const isFunctionTypedLocalDep = functionTypedLocalBindings.has(depName);
          if (!isFunctionTypedPropDep && !isFunctionTypedLocalDep) continue;

          const classification = classifyCallableReadsInsideEffect(depName, callback);
          if (!classification.hasAnyRead) continue;
          if (!classification.allReadsAreInSubHandlers) continue;

          const subHandlerLabel = classification.firstSubHandlerName
            ? `\`${classification.firstSubHandlerName}\``
            : "an async sub-handler";
          context.report({
            node: depElement,
            message: `"${depName}" is read only inside ${subHandlerLabel} — wrap it with useEffectEvent and remove it from the dep array so the effect doesn't re-synchronize on every parent render`,
          });
        }
      }
    };

    const propStackTracker = createComponentPropStackTracker({
      onComponentEnter: checkComponent,
    });

    return propStackTracker.visitors;
  },
};
