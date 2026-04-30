import {
  CASCADING_SET_STATE_THRESHOLD,
  EFFECT_HOOK_NAMES,
  HOOKS_WITH_DEPS,
  RELATED_USE_STATE_THRESHOLD,
  TRIVIAL_INITIALIZER_NAMES,
} from "../constants.js";
import {
  containsFetchCall,
  countSetStateCalls,
  extractDestructuredPropNames,
  getCallbackStatements,
  getEffectCallback,
  isComponentAssignment,
  isHookCall,
  isSetterCall,
  isSetterIdentifier,
  isUppercaseName,
  walkAst,
} from "../helpers.js";
import type { EsTreeNode, Rule, RuleContext } from "../types.js";

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
      for (const statement of statements) {
        const setStateArguments = statement.expression.arguments;
        if (!setStateArguments?.length) continue;

        const referencedIdentifiers: string[] = [];
        walkAst(setStateArguments[0], (child: EsTreeNode) => {
          if (child.type === "Identifier") referencedIdentifiers.push(child.name);
        });

        const nonSetterIdentifiers = referencedIdentifiers.filter(
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

      if (allArgumentsDeriveFromDeps) {
        context.report({
          node,
          message: hasAnyDependencyReference
            ? "Derived state in useEffect — compute during render instead"
            : "State reset in useEffect — use a key prop to reset component state when props change",
        });
      }
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
      if (
        soleStatement.type === "IfStatement" &&
        soleStatement.test?.type === "Identifier" &&
        dependencyNames.has(soleStatement.test.name)
      ) {
        context.report({
          node,
          message:
            "useEffect simulating an event handler — move logic to an actual event handler instead",
        });
      }
    },
  }),
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

    const isPropName = (name: string): boolean => {
      for (let i = componentPropStack.length - 1; i >= 0; i--) {
        if (componentPropStack[i].has(name)) return true;
      }
      return false;
    };

    return {
      FunctionDeclaration(node: EsTreeNode) {
        if (!node.id?.name || !isUppercaseName(node.id.name)) return;
        componentPropStack.push(extractDestructuredPropNames(node.params ?? []));
      },
      "FunctionDeclaration:exit"(node: EsTreeNode) {
        if (!node.id?.name || !isUppercaseName(node.id.name)) return;
        componentPropStack.pop();
      },
      VariableDeclarator(node: EsTreeNode) {
        if (!isComponentAssignment(node)) return;
        componentPropStack.push(extractDestructuredPropNames(node.init?.params ?? []));
      },
      "VariableDeclarator:exit"(node: EsTreeNode) {
        if (!isComponentAssignment(node)) return;
        componentPropStack.pop();
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

    const isPropName = (name: string): boolean => {
      for (let i = componentPropParamStack.length - 1; i >= 0; i--) {
        if (componentPropParamStack[i].has(name)) return true;
      }
      return false;
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
        if (!isComponentAssignment(node)) return;
        enterComponentParams(node.init?.params);
      },
      "VariableDeclarator:exit"(node: EsTreeNode) {
        if (!isComponentAssignment(node)) return;
        componentPropParamStack.pop();
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
      for (let i = componentBindingStack.length - 1; i >= 0; i--) {
        if (componentBindingStack[i].has(name)) return true;
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
