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
  isSetterIdentifier,
  isUppercaseName,
  walkAst,
} from "../helpers.js";
import type { EsTreeNode, Rule, RuleContext } from "../types.js";

export const noDerivedStateEffect: Rule = {
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNode) {
      if (!isHookCall(node, EFFECT_HOOK_NAMES) || node.arguments.length < 2) return;

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

      const containsOnlySetStateCalls = statements.every(
        (statement: EsTreeNode) =>
          statement.type === "ExpressionStatement" &&
          statement.expression?.type === "CallExpression" &&
          statement.expression.callee?.type === "Identifier" &&
          isSetterIdentifier(statement.expression.callee.name),
      );
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
      if (!isHookCall(node, EFFECT_HOOK_NAMES) || node.arguments.length < 2) return;

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
    const componentPropNames = new Set<string>();

    return {
      FunctionDeclaration(node: EsTreeNode) {
        if (!node.id?.name || !isUppercaseName(node.id.name)) return;
        for (const name of extractDestructuredPropNames(node.params ?? [])) {
          componentPropNames.add(name);
        }
      },
      VariableDeclarator(node: EsTreeNode) {
        if (!isComponentAssignment(node)) return;
        for (const name of extractDestructuredPropNames(node.init?.params ?? [])) {
          componentPropNames.add(name);
        }
      },
      CallExpression(node: EsTreeNode) {
        if (!isHookCall(node, "useState") || !node.arguments?.length) return;
        const initializer = node.arguments[0];
        if (initializer.type !== "Identifier") return;

        if (componentPropNames.has(initializer.name)) {
          context.report({
            node,
            message: `useState initialized from prop "${initializer.name}" — if this value should stay in sync with the prop, derive it during render instead`,
          });
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

export const rerenderFunctionalSetstate: Rule = {
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNode) {
      if (node.callee?.type !== "Identifier" || !isSetterIdentifier(node.callee.name)) return;
      if (!node.arguments?.length) return;

      const argument = node.arguments[0];
      if (
        argument.type === "BinaryExpression" &&
        (argument.operator === "+" || argument.operator === "-") &&
        argument.left?.type === "Identifier"
      ) {
        context.report({
          node,
          message: `${node.callee.name}(${argument.left.name} ${argument.operator} ...) — use functional update to avoid stale closures`,
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
