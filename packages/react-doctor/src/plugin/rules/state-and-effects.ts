import {
  BUILTIN_GLOBAL_NAMESPACE_NAMES,
  CASCADING_SET_STATE_THRESHOLD,
  EFFECT_HOOK_NAMES,
  EVENT_TRIGGERED_SIDE_EFFECT_CALLEES,
  EVENT_TRIGGERED_SIDE_EFFECT_MEMBER_METHODS,
  HOOKS_WITH_DEPS,
  MUTATING_ARRAY_METHODS,
  RELATED_USE_STATE_THRESHOLD,
  SUBSCRIPTION_METHOD_NAMES,
  TRIVIAL_DERIVATION_CALLEE_NAMES,
  TRIVIAL_INITIALIZER_NAMES,
  UNSUBSCRIPTION_METHOD_NAMES,
} from "../constants.js";
import {
  areExpressionsStructurallyEqual,
  collectPatternNames,
  containsFetchCall,
  countSetStateCalls,
  extractDestructuredPropNames,
  getCallbackStatements,
  getEffectCallback,
  getRootIdentifierName,
  isComponentAssignment,
  isHookCall,
  isSetterCall,
  isSetterIdentifier,
  isUppercaseName,
  walkAst,
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
  create: (context: RuleContext) => {
    // HACK: track per-component useState value names so we can defer
    // to noEventTriggerState when the trigger guard is a state-typed
    // dep AND the consequent matches the side-effect-callee allowlist.
    // Without the second predicate the deference silently drops
    // warnings on `if (trigger) customAction()` shapes where the
    // callee isn't in noEventTriggerState's allowlist.
    const useStateValueNamesStack: Array<Set<string>> = [];
    const collectUseStateValueNames = (componentBody: EsTreeNode): Set<string> => {
      const stateNames = new Set<string>();
      if (componentBody?.type !== "BlockStatement") return stateNames;
      for (const statement of componentBody.body ?? []) {
        if (statement.type !== "VariableDeclaration") continue;
        for (const declarator of statement.declarations ?? []) {
          if (declarator.id?.type !== "ArrayPattern") continue;
          if (declarator.init?.type !== "CallExpression") continue;
          if (!isHookCall(declarator.init, "useState")) continue;
          const valueElement = declarator.id.elements?.[0];
          if (valueElement?.type === "Identifier") stateNames.add(valueElement.name);
        }
      }
      return stateNames;
    };
    const isStateValueName = (name: string): boolean => {
      for (let frameIndex = useStateValueNamesStack.length - 1; frameIndex >= 0; frameIndex--) {
        if (useStateValueNamesStack[frameIndex].has(name)) return true;
      }
      return false;
    };

    return {
      FunctionDeclaration(node: EsTreeNode) {
        if (!node.id?.name || !isUppercaseName(node.id.name)) {
          useStateValueNamesStack.push(new Set());
          return;
        }
        useStateValueNamesStack.push(collectUseStateValueNames(node.body));
      },
      "FunctionDeclaration:exit"() {
        useStateValueNamesStack.pop();
      },
      VariableDeclarator(node: EsTreeNode) {
        if (isComponentAssignment(node)) {
          useStateValueNamesStack.push(collectUseStateValueNames(node.init?.body));
          return;
        }
        if (
          node.init?.type === "ArrowFunctionExpression" ||
          node.init?.type === "FunctionExpression"
        ) {
          useStateValueNamesStack.push(new Set());
        }
      },
      "VariableDeclarator:exit"(node: EsTreeNode) {
        if (isComponentAssignment(node)) {
          useStateValueNamesStack.pop();
          return;
        }
        if (
          node.init?.type === "ArrowFunctionExpression" ||
          node.init?.type === "FunctionExpression"
        ) {
          useStateValueNamesStack.pop();
        }
      },
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

        // Defer to noEventTriggerState ONLY when its diagnostic
        // would actually fire. Its narrower preconditions (single
        // dep, side-effect-callee allowlist) mean a deference based
        // only on isStateValueName silently drops warnings for
        // shapes like `if (trigger) customAction();` where neither
        // rule then reports. Match noEventTriggerState's full set
        // here: state-typed dep + recognized side-effect callee in
        // the consequent.
        // Reuse noEventTriggerState's helper instead of duplicating
        // the AST walk + constant lookups; "function would fire"
        // ↔ "callee was found in the consequent".
        if (
          isStateValueName(rootIdentifierName) &&
          findTriggeredSideEffectCalleeName(soleStatement.consequent) !== null
        ) {
          return;
        }

        context.report({
          node,
          message:
            "useEffect simulating an event handler — move logic to an actual event handler instead",
        });
      },
    };
  },
};

export const noDerivedUseState: Rule = {
  create: (context: RuleContext) => {
    // HACK: maintain a stack of per-component prop sets so a prop named X
    // in ComponentA doesn't leak into ComponentB's useState checks. We
    // only push/pop on FunctionDeclaration and component-shaped
    // VariableDeclarator; FunctionExpression / ArrowFunctionExpression
    // inside those don't get their own scope (avoids double-push when
    // `const Foo = function () {…}` matches both visitors). useState
    // initializers walk the stack top-to-bottom; nested callback params
    // are not modeled here (a known limitation — pre-existing).
    const componentPropStack: Array<Set<string>> = [];

    // HACK: empty stack frames are barriers — pushed when entering a
    // non-component FunctionDeclaration / ArrowFunctionExpression so
    // identifiers inside the helper don't resolve against an outer
    // component's props (a closed-over `value` is NOT a prop of the
    // helper). Stop the walk at the first empty frame so the lookup
    // honors the barrier the visitor pushed.
    const isPropName = (name: string): boolean => {
      for (let stackIndex = componentPropStack.length - 1; stackIndex >= 0; stackIndex--) {
        const frame = componentPropStack[stackIndex];
        if (frame.size === 0) return false;
        if (frame.has(name)) return true;
      }
      return false;
    };

    const isFunctionLikeVariableDeclarator = (node: EsTreeNode): boolean => {
      if (node.type !== "VariableDeclarator") return false;
      return (
        node.init?.type === "ArrowFunctionExpression" || node.init?.type === "FunctionExpression"
      );
    };

    return {
      FunctionDeclaration(node: EsTreeNode) {
        if (!node.id?.name || !isUppercaseName(node.id.name)) {
          // Non-component FunctionDeclarations push an empty barrier so
          // an outer component's props don't leak into the helper.
          // Matches noPropCallbackInEffect's scope behavior.
          componentPropStack.push(new Set());
          return;
        }
        componentPropStack.push(extractDestructuredPropNames(node.params ?? []));
      },
      "FunctionDeclaration:exit"() {
        componentPropStack.pop();
      },
      VariableDeclarator(node: EsTreeNode) {
        if (isComponentAssignment(node)) {
          componentPropStack.push(extractDestructuredPropNames(node.init?.params ?? []));
          return;
        }
        if (isFunctionLikeVariableDeclarator(node)) {
          componentPropStack.push(new Set());
        }
      },
      "VariableDeclarator:exit"(node: EsTreeNode) {
        if (isComponentAssignment(node) || isFunctionLikeVariableDeclarator(node)) {
          componentPropStack.pop();
        }
      },
      CallExpression(node: EsTreeNode) {
        if (!isHookCall(node, "useState") || !node.arguments?.length) return;
        if (componentPropStack.length === 0) return;
        const initializer = node.arguments[0];

        if (initializer.type === "Identifier" && isPropName(initializer.name)) {
          context.report({
            node,
            message: `useState initialized from prop "${initializer.name}" — if this value should stay in sync with the prop, derive it during render instead`,
          });
          return;
        }

        if (initializer.type === "MemberExpression" && !initializer.computed) {
          let rootIdentifierName: string | null = null;
          let cursor: EsTreeNode = initializer;
          while (cursor?.type === "MemberExpression") {
            cursor = cursor.object;
          }
          if (cursor?.type === "Identifier") rootIdentifierName = cursor.name;

          if (rootIdentifierName && isPropName(rootIdentifierName)) {
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
    const componentPropParamStack: Array<Set<string>> = [];

    const enterComponentParams = (params: EsTreeNode[] | undefined): void => {
      const propNames = extractDestructuredPropNames(params ?? []);
      componentPropParamStack.push(propNames);
    };

    // HACK: empty stack frames are barriers — pushed when entering a
    // non-component FunctionDeclaration / ArrowFunctionExpression so
    // identifiers inside the helper don't resolve against an outer
    // component's props. Stop the walk at the first empty frame so
    // the lookup honors the barrier the visitor pushed.
    const isPropName = (name: string): boolean => {
      for (let stackIndex = componentPropParamStack.length - 1; stackIndex >= 0; stackIndex--) {
        const frame = componentPropParamStack[stackIndex];
        if (frame.size === 0) return false;
        if (frame.has(name)) return true;
      }
      return false;
    };

    const isFunctionLikeVariableDeclarator = (node: EsTreeNode): boolean => {
      if (node.type !== "VariableDeclarator") return false;
      return (
        node.init?.type === "ArrowFunctionExpression" || node.init?.type === "FunctionExpression"
      );
    };

    return {
      FunctionDeclaration(node: EsTreeNode) {
        if (!node.id?.name || !isUppercaseName(node.id.name)) {
          componentPropParamStack.push(new Set());
          return;
        }
        enterComponentParams(node.params);
      },
      "FunctionDeclaration:exit"() {
        componentPropParamStack.pop();
      },
      VariableDeclarator(node: EsTreeNode) {
        if (isComponentAssignment(node)) {
          enterComponentParams(node.init?.params);
          return;
        }
        // Non-component arrow/function helpers also push an empty barrier
        // so identifiers inside the helper don't resolve against an outer
        // component's props (matches FunctionDeclaration handling).
        if (isFunctionLikeVariableDeclarator(node)) {
          componentPropParamStack.push(new Set());
        }
      },
      "VariableDeclarator:exit"(node: EsTreeNode) {
        if (isComponentAssignment(node) || isFunctionLikeVariableDeclarator(node)) {
          componentPropParamStack.pop();
        }
      },
      CallExpression(node: EsTreeNode) {
        if (!isHookCall(node, EFFECT_HOOK_NAMES) || (node.arguments?.length ?? 0) < 2) return;
        if (componentPropParamStack.length === 0) return;
        const callback = getEffectCallback(node);
        if (!callback) return;
        const depsNode = node.arguments[1];
        if (depsNode.type !== "ArrayExpression" || !depsNode.elements?.length) return;

        // Body must invoke a prop callback as a top-level expression.
        const bodyStatements = getCallbackStatements(callback);
        for (const stmt of bodyStatements) {
          let invokedPropName: string | null = null;
          if (
            stmt.type === "ExpressionStatement" &&
            stmt.expression?.type === "CallExpression" &&
            stmt.expression.callee?.type === "Identifier" &&
            isPropName(stmt.expression.callee.name)
          ) {
            invokedPropName = stmt.expression.callee.name;
          }
          if (!invokedPropName) continue;

          // Only flag if at least one dep is a non-prop (state-shape)
          // identifier — otherwise the effect is just adapting to prop
          // changes (legit pattern).
          const hasStateLikeDep = depsNode.elements.some(
            (element: EsTreeNode) => element?.type === "Identifier" && !isPropName(element.name),
          );
          if (!hasStateLikeDep) continue;

          context.report({
            node: stmt,
            message: `useEffect calls prop callback "${invokedPropName}" with local state in deps — this is the "lift state via callback" anti-pattern; lift state into a shared Provider so both sides read the same source`,
          });
        }
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
    const componentBindingStack: Array<Set<string>> = [];

    const isEffectEventBinding = (name: string): boolean => {
      for (let stackIndex = componentBindingStack.length - 1; stackIndex >= 0; stackIndex--) {
        if (componentBindingStack[stackIndex].has(name)) return true;
      }
      return false;
    };

    const enterComponent = (): void => {
      componentBindingStack.push(new Set());
    };
    const exitComponent = (): void => {
      componentBindingStack.pop();
    };

    return {
      FunctionDeclaration(node: EsTreeNode) {
        if (!node.id?.name || !isUppercaseName(node.id.name)) return;
        enterComponent();
      },
      "FunctionDeclaration:exit"(node: EsTreeNode) {
        if (!node.id?.name || !isUppercaseName(node.id.name)) return;
        exitComponent();
      },
      VariableDeclarator(node: EsTreeNode) {
        if (isComponentAssignment(node)) {
          enterComponent();
          return;
        }
        if (componentBindingStack.length === 0) return;
        if (node.id?.type !== "Identifier") return;
        const init = node.init;
        if (!init || init.type !== "CallExpression") return;
        if (!isHookCall(init, "useEffectEvent")) return;
        componentBindingStack[componentBindingStack.length - 1].add(node.id.name);
      },
      "VariableDeclarator:exit"(node: EsTreeNode) {
        if (isComponentAssignment(node)) exitComponent();
      },
      CallExpression(node: EsTreeNode) {
        if (!isHookCall(node, HOOKS_WITH_DEPS) || node.arguments.length < 2) return;
        if (componentBindingStack.length === 0) return;
        const depsNode = node.arguments[1];
        if (depsNode.type !== "ArrayExpression") return;

        for (const element of depsNode.elements ?? []) {
          if (element?.type !== "Identifier") continue;
          if (isEffectEventBinding(element.name)) {
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

const walkInsideStatementBlocks = (
  node: EsTreeNode,
  visitor: (child: EsTreeNode) => void,
): void => {
  if (!node || typeof node !== "object") return;
  if (
    node.type === "FunctionDeclaration" ||
    node.type === "FunctionExpression" ||
    node.type === "ArrowFunctionExpression"
  ) {
    return;
  }
  visitor(node);
  for (const key of Object.keys(node)) {
    if (key === "parent") continue;
    const child = node[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        if (item && typeof item === "object" && item.type) walkInsideStatementBlocks(item, visitor);
      }
    } else if (child && typeof child === "object" && child.type) {
      walkInsideStatementBlocks(child, visitor);
    }
  }
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
  const returnedValue = lastStatement.argument;
  if (!returnedValue) return false;

  if (
    boundUnsubscribeName &&
    returnedValue.type === "Identifier" &&
    returnedValue.name === boundUnsubscribeName
  ) {
    return true;
  }

  if (
    returnedValue.type === "ArrowFunctionExpression" ||
    returnedValue.type === "FunctionExpression"
  ) {
    let didReleaseSubscription = false;
    walkAst(returnedValue, (child: EsTreeNode) => {
      if (didReleaseSubscription) return;
      if (child.type !== "CallExpression") return;

      if (
        boundUnsubscribeName &&
        child.callee?.type === "Identifier" &&
        child.callee.name === boundUnsubscribeName
      ) {
        didReleaseSubscription = true;
        return;
      }

      if (
        child.callee?.type === "MemberExpression" &&
        child.callee.property?.type === "Identifier" &&
        UNSUBSCRIPTION_METHOD_NAMES.has(child.callee.property.name)
      ) {
        didReleaseSubscription = true;
      }
    });
    return didReleaseSubscription;
  }

  return false;
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
    if (
      callee?.type === "MemberExpression" &&
      callee.property?.type === "Identifier" &&
      EVENT_TRIGGERED_SIDE_EFFECT_MEMBER_METHODS.has(callee.property.name)
    ) {
      let cursor: EsTreeNode | undefined = callee;
      while (cursor?.type === "MemberExpression") cursor = cursor.object;
      const rootName = cursor?.type === "Identifier" ? cursor.name : null;
      foundCalleeName = rootName ? `${rootName}.${callee.property.name}` : callee.property.name;
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
