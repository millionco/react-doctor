import { EFFECT_HOOK_NAMES, SUBSCRIPTION_METHOD_NAMES } from "../../constants/react.js";
import { areExpressionsStructurallyEqual } from "../../utils/are-expressions-structurally-equal.js";
import { defineRule } from "../../utils/define-rule.js";
import { getCallbackStatements } from "../../utils/get-callback-statements.js";
import { getEffectCallback } from "../../utils/get-effect-callback.js";
import { isComponentAssignment } from "../../utils/is-component-assignment.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { isSetterIdentifier } from "../../utils/is-setter-identifier.js";
import { isUppercaseName } from "../../utils/is-uppercase-name.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isCleanupReturn } from "./utils/is-cleanup-return.js";
import { collectUseStateBindings } from "./utils/collect-use-state-bindings.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

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
  if (!isNodeOfType(componentBody, "BlockStatement")) return effectCalls;
  for (const statement of componentBody.body ?? []) {
    walkAst(statement, (child: EsTreeNode) => {
      if (isNodeOfType(child, "CallExpression") && isHookCall(child, EFFECT_HOOK_NAMES)) {
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
    if (isNodeOfType(statement, "VariableDeclaration")) {
      for (const declarator of statement.declarations ?? []) {
        const init = declarator.init;
        if (!isNodeOfType(init, "CallExpression")) continue;
        if (!isNodeOfType(init.callee, "MemberExpression")) continue;
        if (!isNodeOfType(init.callee.property, "Identifier")) continue;
        if (!SUBSCRIPTION_METHOD_NAMES.has(init.callee.property.name)) continue;
        const boundUnsubscribeName = isNodeOfType(declarator.id, "Identifier")
          ? declarator.id.name
          : null;
        return { call: init, boundUnsubscribeName };
      }
    }
    if (isNodeOfType(statement, "ExpressionStatement")) {
      const expression = statement.expression;
      if (!isNodeOfType(expression, "CallExpression")) continue;
      if (!isNodeOfType(expression.callee, "MemberExpression")) continue;
      if (!isNodeOfType(expression.callee.property, "Identifier")) continue;
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
  if (!isNodeOfType(subscribeCall, "CallExpression")) return null;
  for (const argument of subscribeCall.arguments ?? []) {
    if (
      isNodeOfType(argument, "ArrowFunctionExpression") ||
      isNodeOfType(argument, "FunctionExpression")
    ) {
      return argument;
    }
    if (isNodeOfType(argument, "Identifier")) {
      for (const statement of effectBodyStatements) {
        if (!isNodeOfType(statement, "VariableDeclaration")) continue;
        for (const declarator of statement.declarations ?? []) {
          if (!isNodeOfType(declarator.id, "Identifier")) continue;
          if (declarator.id.name !== argument.name) continue;
          const init = declarator.init;
          if (
            isNodeOfType(init, "ArrowFunctionExpression") ||
            isNodeOfType(init, "FunctionExpression")
          ) {
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
  const expression = isNodeOfType(onlyStatement, "ExpressionStatement")
    ? onlyStatement.expression
    : onlyStatement;
  if (!isNodeOfType(expression, "CallExpression")) return null;
  if (!isNodeOfType(expression.callee, "Identifier")) return null;
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
  if (!isNodeOfType(lastStatement, "ReturnStatement")) return false;
  const knownBoundReleaseNames = new Set<string>();
  if (boundUnsubscribeName) knownBoundReleaseNames.add(boundUnsubscribeName);
  return isCleanupReturn(lastStatement.argument, knownBoundReleaseNames);
};

export const preferUseSyncExternalStore = defineRule<Rule>({
  id: "prefer-use-sync-external-store",
  severity: "warn",
  recommendation:
    "Replace the `useState(getSnapshot())` + `useEffect(() => store.subscribe(() => setSnapshot(getSnapshot())))` pair with `useSyncExternalStore(store.subscribe, getSnapshot)`. The hook handles tearing during concurrent renders and SSR snapshots; the manual subscribe pattern doesn't",
  create: (context: RuleContext) => {
    const checkComponent = (componentBody: EsTreeNode | null | undefined): void => {
      if (!componentBody || !isNodeOfType(componentBody, "BlockStatement")) return;

      const useStateBindings = collectUseStateBindings(componentBody);
      if (useStateBindings.length === 0) return;

      const useStateInitializerByValueName = new Map<string, EsTreeNode>();
      for (const binding of useStateBindings) {
        const useStateCall = binding.declarator.init;
        if (!useStateCall || !isNodeOfType(useStateCall, "CallExpression")) continue;
        const initializerArgument = useStateCall.arguments?.[0];
        if (!initializerArgument) continue;
        // HACK: useState(() => getSnapshot()) — unwrap the lazy
        // initializer so the structural match against the
        // subscribe-handler's setter argument still resolves.
        if (
          (isNodeOfType(initializerArgument, "ArrowFunctionExpression") ||
            isNodeOfType(initializerArgument, "FunctionExpression")) &&
          !isNodeOfType(initializerArgument.body, "BlockStatement")
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
        if (!isNodeOfType(effectCall, "CallExpression")) continue;
        if ((effectCall.arguments?.length ?? 0) < 2) continue;
        const depsNode = effectCall.arguments[1];
        if (!isNodeOfType(depsNode, "ArrayExpression")) continue;
        if ((depsNode.elements?.length ?? 0) !== 0) continue;

        const callback = getEffectCallback(effectCall);
        if (
          !callback ||
          (!isNodeOfType(callback, "ArrowFunctionExpression") &&
            !isNodeOfType(callback, "FunctionExpression"))
        )
          continue;
        if (!isNodeOfType(callback.body, "BlockStatement")) continue;
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
      FunctionDeclaration(node: EsTreeNodeOfType<"FunctionDeclaration">) {
        if (!node.id?.name || !isUppercaseName(node.id.name)) return;
        checkComponent(node.body);
      },
      VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
        if (!isComponentAssignment(node)) return;
        if (
          !isNodeOfType(node.init, "ArrowFunctionExpression") &&
          !isNodeOfType(node.init, "FunctionExpression")
        )
          return;
        checkComponent(node.init.body);
      },
    };
  },
});
