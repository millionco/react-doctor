import { SETTER_PATTERN, HOOKS_WITH_DEPS } from "../../constants/react.js";
import { createComponentPropStackTracker } from "../../utils/create-component-prop-stack-tracker.js";
import { collectPatternNames } from "../../utils/collect-pattern-names.js";
import { defineRule } from "../../utils/define-rule.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";

const STABLE_HOOK_RETURN_NAMES = new Set([
  "useRef",
  "useEffectEvent",
  "experimental_useEffectEvent",
]);

const REACTIVE_HOOK_STATE_NAMES = new Set(["useState", "useReducer"]);

const REACTIVE_HOOK_RETURN_NAMES = new Set(["useContext"]);

const collectReactiveAndStableBindings = (
  componentBody: EsTreeNode,
  propNames: Set<string>,
): { reactiveNames: Set<string>; stableNames: Set<string> } => {
  const reactiveNames = new Set(propNames);
  const stableNames = new Set<string>();

  if (!isNodeOfType(componentBody, "BlockStatement")) {
    return { reactiveNames, stableNames };
  }

  for (const statement of componentBody.body ?? []) {
    if (!isNodeOfType(statement, "VariableDeclaration")) continue;
    for (const declarator of statement.declarations ?? []) {
      if (!isNodeOfType(declarator.init, "CallExpression")) continue;

      const calleeName = getSimpleCalleeName(declarator.init);
      if (!calleeName) continue;

      if (REACTIVE_HOOK_STATE_NAMES.has(calleeName)) {
        if (isNodeOfType(declarator.id, "ArrayPattern")) {
          const elements = declarator.id.elements ?? [];
          const stateValue = elements[0];
          const stateSetter = elements[1];
          if (isNodeOfType(stateValue, "Identifier")) {
            reactiveNames.add(stateValue.name);
          }
          if (isNodeOfType(stateSetter, "Identifier")) {
            stableNames.add(stateSetter.name);
          }
        }
        continue;
      }

      if (REACTIVE_HOOK_RETURN_NAMES.has(calleeName)) {
        if (isNodeOfType(declarator.id, "Identifier")) {
          reactiveNames.add(declarator.id.name);
        }
        continue;
      }

      if (STABLE_HOOK_RETURN_NAMES.has(calleeName)) {
        if (isNodeOfType(declarator.id, "Identifier")) {
          stableNames.add(declarator.id.name);
        }
        continue;
      }

      if (calleeName === "useCallback" || calleeName === "useMemo") {
        if (isNodeOfType(declarator.id, "Identifier")) {
          stableNames.add(declarator.id.name);
        }
        continue;
      }
    }
  }

  return { reactiveNames, stableNames };
};

const getSimpleCalleeName = (node: EsTreeNode): string | null => {
  if (!isNodeOfType(node, "CallExpression")) return null;
  if (isNodeOfType(node.callee, "Identifier")) return node.callee.name;
  return null;
};

const collectLocalBindings = (callbackNode: EsTreeNode): Set<string> => {
  const localNames = new Set<string>();

  const params = (callbackNode as { params?: EsTreeNode[] }).params ?? [];
  for (const param of params) {
    collectPatternNames(param, localNames);
  }

  walkAst(callbackNode, (child: EsTreeNode) => {
    if (
      isNodeOfType(child, "ArrowFunctionExpression") ||
      isNodeOfType(child, "FunctionExpression") ||
      isNodeOfType(child, "FunctionDeclaration")
    ) {
      if (child !== callbackNode) return false;
    }

    if (isNodeOfType(child, "VariableDeclarator") && isNodeOfType(child.id, "Identifier")) {
      localNames.add(child.id.name);
    }
    if (isNodeOfType(child, "VariableDeclarator")) {
      collectPatternNames(child.id, localNames);
    }
  });

  return localNames;
};

const isPropertyAccessPosition = (identifier: EsTreeNode): boolean => {
  const parent = identifier.parent;
  if (
    isNodeOfType(parent, "MemberExpression") &&
    !parent.computed &&
    parent.property === identifier
  ) {
    return true;
  }
  if (
    isNodeOfType(parent, "Property") &&
    !parent.computed &&
    !parent.shorthand &&
    parent.key === identifier
  ) {
    return true;
  }
  return false;
};

const isInsideNestedFunction = (identifier: EsTreeNode, callbackNode: EsTreeNode): boolean => {
  let cursor: EsTreeNode | null = identifier.parent ?? null;
  while (cursor && cursor !== callbackNode) {
    if (
      isNodeOfType(cursor, "ArrowFunctionExpression") ||
      isNodeOfType(cursor, "FunctionExpression") ||
      isNodeOfType(cursor, "FunctionDeclaration")
    ) {
      return true;
    }
    cursor = cursor.parent ?? null;
  }
  return false;
};

interface StaleCaptureResult {
  capturedReactiveNames: Set<string>;
}

const findStaleCapturesInCallback = (
  callbackNode: EsTreeNode,
  reactiveNames: Set<string>,
  stableNames: Set<string>,
): StaleCaptureResult => {
  const capturedReactiveNames = new Set<string>();
  const localBindings = collectLocalBindings(callbackNode);

  walkAst(callbackNode, (child: EsTreeNode) => {
    if (!isNodeOfType(child, "Identifier")) return;
    const identifierName = child.name;

    if (localBindings.has(identifierName)) return;
    if (stableNames.has(identifierName)) return;
    if (SETTER_PATTERN.test(identifierName)) return;
    if (isPropertyAccessPosition(child)) return;
    if (isInsideNestedFunction(child, callbackNode)) return;

    if (reactiveNames.has(identifierName)) {
      capturedReactiveNames.add(identifierName);
    }
  });

  return { capturedReactiveNames };
};

const isEmptyDepsArray = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "ArrayExpression") && (node.elements?.length ?? 0) === 0;

const isFunctionExpression = (node: EsTreeNode | null | undefined): boolean =>
  Boolean(node) &&
  (isNodeOfType(node, "ArrowFunctionExpression") || isNodeOfType(node, "FunctionExpression"));

const doesComponentBodyReassignRefCurrent = (
  componentBody: EsTreeNode,
  refBindingName: string,
): boolean => {
  let hasReassignment = false;
  walkAst(componentBody, (child: EsTreeNode) => {
    if (hasReassignment) return false;

    if (!isNodeOfType(child, "AssignmentExpression")) return;
    const left = child.left;
    if (
      isNodeOfType(left, "MemberExpression") &&
      isNodeOfType(left.object, "Identifier") &&
      left.object.name === refBindingName &&
      isNodeOfType(left.property, "Identifier") &&
      left.property.name === "current"
    ) {
      hasReassignment = true;
      return false;
    }
  });
  return hasReassignment;
};

const formatCapturedNames = (names: Set<string>): string => {
  const sortedNames = [...names].sort();
  if (sortedNames.length === 1) return `\`${sortedNames[0]}\``;
  if (sortedNames.length === 2) return `\`${sortedNames[0]}\` and \`${sortedNames[1]}\``;
  const lastElement = sortedNames.pop();
  return `${sortedNames.map((name) => `\`${name}\``).join(", ")}, and \`${lastElement}\``;
};

export const noStaleClosure = defineRule<Rule>({
  id: "no-stale-closure",
  severity: "warn",
  tags: ["test-noise"],
  recommendation:
    "Wrap the callback with `useEffectEvent(callback)` (React 19+) so it always reads the latest values without being a reactive dependency, or use a `useNonReactiveCallback` helper that stores the latest callback in a ref via useInsertionEffect. See https://react.dev/learn/separating-events-from-effects",
  create: (context: RuleContext) => {
    const checkComponent = (componentBody: EsTreeNode | undefined): void => {
      if (!componentBody || !isNodeOfType(componentBody, "BlockStatement")) return;

      const currentPropNames = propStackTracker.getCurrentPropNames();
      const { reactiveNames, stableNames } = collectReactiveAndStableBindings(
        componentBody,
        currentPropNames,
      );

      for (const statement of componentBody.body ?? []) {
        if (!isNodeOfType(statement, "VariableDeclaration")) continue;

        for (const declarator of statement.declarations ?? []) {
          if (!isNodeOfType(declarator.init, "CallExpression")) continue;

          const calleeName = getSimpleCalleeName(declarator.init);
          if (!calleeName) continue;

          if (calleeName === "useCallback") {
            checkUseCallbackWithEmptyDeps(declarator, reactiveNames, stableNames, context);
            continue;
          }

          if (calleeName === "useRef") {
            checkUseRefWithStaleCallback(
              declarator,
              componentBody,
              reactiveNames,
              stableNames,
              context,
            );
            continue;
          }
        }
      }
    };

    const propStackTracker = createComponentPropStackTracker({
      onComponentEnter: checkComponent,
    });

    return propStackTracker.visitors;
  },
});

const checkUseCallbackWithEmptyDeps = (
  declarator: EsTreeNodeOfType<"VariableDeclarator">,
  reactiveNames: Set<string>,
  stableNames: Set<string>,
  context: RuleContext,
): void => {
  const callExpression = declarator.init;
  if (!isNodeOfType(callExpression, "CallExpression")) return;

  const callArguments = callExpression.arguments ?? [];
  if (callArguments.length < 2) return;

  const depsNode = callArguments[1];
  if (!isEmptyDepsArray(depsNode)) return;

  const callbackNode = callArguments[0];
  if (!isFunctionExpression(callbackNode)) return;

  const { capturedReactiveNames } = findStaleCapturesInCallback(
    callbackNode,
    reactiveNames,
    stableNames,
  );

  if (capturedReactiveNames.size === 0) return;

  const bindingName = isNodeOfType(declarator.id, "Identifier") ? declarator.id.name : "callback";
  const capturedLabel = formatCapturedNames(capturedReactiveNames);

  context.report({
    node: callExpression,
    message: `"${bindingName}" is a useCallback with empty deps but captures reactive ${
      capturedReactiveNames.size > 1 ? "values" : "value"
    } ${capturedLabel} — ${capturedLabel} will be stale after the first render. Use useEffectEvent or useNonReactiveCallback to always read the latest values with a stable identity`,
  });
};

const checkUseRefWithStaleCallback = (
  declarator: EsTreeNodeOfType<"VariableDeclarator">,
  componentBody: EsTreeNode,
  reactiveNames: Set<string>,
  stableNames: Set<string>,
  context: RuleContext,
): void => {
  const callExpression = declarator.init;
  if (!isNodeOfType(callExpression, "CallExpression")) return;

  const callArguments = callExpression.arguments ?? [];
  if (callArguments.length < 1) return;

  const initializer = callArguments[0];
  if (!isFunctionExpression(initializer)) return;

  const refBindingName = isNodeOfType(declarator.id, "Identifier") ? declarator.id.name : null;
  if (!refBindingName) return;

  if (doesComponentBodyReassignRefCurrent(componentBody, refBindingName)) return;

  const { capturedReactiveNames } = findStaleCapturesInCallback(
    initializer,
    reactiveNames,
    stableNames,
  );

  if (capturedReactiveNames.size === 0) return;

  const capturedLabel = formatCapturedNames(capturedReactiveNames);

  context.report({
    node: callExpression,
    message: `useRef stores a callback capturing reactive ${
      capturedReactiveNames.size > 1 ? "values" : "value"
    } ${capturedLabel} but "${refBindingName}.current" is never reassigned — ${capturedLabel} will be stale. Use useEffectEvent or useNonReactiveCallback instead`,
  });
};
