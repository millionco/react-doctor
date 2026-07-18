import { EFFECT_HOOK_NAMES, SUBSCRIPTION_METHOD_NAMES } from "../../constants/react.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import { areExpressionsStructurallyEqual } from "../../utils/are-expressions-structurally-equal.js";
import { defineRule } from "../../utils/define-rule.js";
import { findProgramRoot } from "../../utils/find-program-root.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { getCallbackStatements } from "../../utils/get-callback-statements.js";
import { getEffectCallback } from "../../utils/get-effect-callback.js";
import { isComponentAssignment } from "../../utils/is-component-assignment.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isReactHookCall } from "../../utils/is-react-hook-call.js";
import { isReactHookName } from "../../utils/is-react-hook-name.js";
import { isSetterIdentifier } from "../../utils/is-setter-identifier.js";
import { isUppercaseName } from "../../utils/is-uppercase-name.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isCleanupReturn } from "./utils/is-cleanup-return.js";
import { isCleanupReturningSubscribeLikeCallExpression } from "./utils/is-subscribe-like-call-expression.js";
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
const findUseEffectsInComponent = (
  componentBody: EsTreeNode | undefined,
  scopes: ScopeAnalysis,
): EsTreeNode[] => {
  const effectCalls: EsTreeNode[] = [];
  if (!isNodeOfType(componentBody, "BlockStatement")) return effectCalls;
  for (const statement of componentBody.body ?? []) {
    walkAst(statement, (child: EsTreeNode) => {
      if (
        isNodeOfType(child, "CallExpression") &&
        isReactHookCall(child, EFFECT_HOOK_NAMES, scopes)
      ) {
        effectCalls.push(child);
      }
    });
  }
  return effectCalls;
};

interface SubscriptionCallMatch {
  call: EsTreeNode;
  boundReleaseName: string | null;
  boundSubscriptionName: string | null;
}

const findSubscriptionCall = (effectBodyStatements: EsTreeNode[]): SubscriptionCallMatch | null => {
  for (const statement of effectBodyStatements) {
    if (isNodeOfType(statement, "VariableDeclaration")) {
      for (const declarator of statement.declarations ?? []) {
        const init = declarator.init;
        if (!isNodeOfType(init, "CallExpression")) continue;
        if (!isNodeOfType(init.callee, "MemberExpression")) continue;
        if (!isNodeOfType(init.callee.property, "Identifier")) continue;
        if (!SUBSCRIPTION_METHOD_NAMES.has(init.callee.property.name)) continue;
        const boundSubscriptionName = isNodeOfType(declarator.id, "Identifier")
          ? declarator.id.name
          : null;
        return {
          call: init,
          boundReleaseName:
            boundSubscriptionName && isCleanupReturningSubscribeLikeCallExpression(init)
              ? boundSubscriptionName
              : null,
          boundSubscriptionName,
        };
      }
    }
    if (isNodeOfType(statement, "ExpressionStatement")) {
      const expression = statement.expression;
      if (!isNodeOfType(expression, "CallExpression")) continue;
      if (!isNodeOfType(expression.callee, "MemberExpression")) continue;
      if (!isNodeOfType(expression.callee.property, "Identifier")) continue;
      if (!SUBSCRIPTION_METHOD_NAMES.has(expression.callee.property.name)) continue;
      return { call: expression, boundReleaseName: null, boundSubscriptionName: null };
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

// `useState(false)` + a handler calling `setX(false)` matches structurally,
// but a bare literal is not a store snapshot — it's a UI-state reset on a
// browser event (bfcache restore, window focus). Only expressions that
// actually read something (call, member, identifier) count as snapshots.
const isTrivialLiteralExpression = (expression: EsTreeNode): boolean => {
  if (isNodeOfType(expression, "Literal")) return true;
  if (isNodeOfType(expression, "Identifier")) return expression.name === "undefined";
  if (isNodeOfType(expression, "UnaryExpression") && expression.operator === "-") {
    return isNodeOfType(expression.argument, "Literal");
  }
  if (isNodeOfType(expression, "TemplateLiteral")) {
    return (expression.expressions?.length ?? 0) === 0;
  }
  return false;
};

const getSingleSetterCallFromHandler = (
  handler: EsTreeNode,
): { setterName: string; setterArgument: EsTreeNode } | null => {
  const handlerStatements = getCallbackStatements(handler);
  if (handlerStatements.length !== 1) return null;
  const onlyStatement = handlerStatements[0];
  // `() => setX(v)`, `() => { setX(v); }`, and `() => { return setX(v); }`
  // are the same handler — unwrap statement/return wrappers alike.
  let expression: EsTreeNode | null | undefined = onlyStatement;
  if (isNodeOfType(onlyStatement, "ExpressionStatement")) expression = onlyStatement.expression;
  if (isNodeOfType(onlyStatement, "ReturnStatement")) expression = onlyStatement.argument;
  if (!expression) return null;
  expression = stripParenExpression(expression);
  if (!isNodeOfType(expression, "CallExpression")) return null;
  if (!isNodeOfType(expression.callee, "Identifier")) return null;
  if (!isSetterIdentifier(expression.callee.name)) return null;
  if (!expression.arguments?.length) return null;
  return {
    setterName: expression.callee.name,
    setterArgument: expression.arguments[0],
  };
};

// ————— Hand-rolled module-scope store (the RD-FN-061 shape) —————
//
//   let sharedState = initial;                     (1) mutable module-scope snapshot
//   const listeners = new Set();                   (2) module-scope listener registry
//   const subscribe = (l) => { listeners.add(l); … } (3) registers its parameter
//   const [s, setS] = useState(sharedState);       (4) snapshot read at render
//   useEffect(() => subscribe(setS), []);          (5) subscription one tick later
//
// Publishes fired between (4) and (5) are lost, and two components reading
// the shared binding at different points of one concurrent render can tear.
// The five-vertex match keeps this as FP-proof as the member-call path
// above: a module `const` config value as initial state (no vertex 1), an
// imported subscribe function (no vertex 3), or a non-empty dependency
// array all stay quiet.
interface ModuleScopeStoreIndex {
  readonly mutableBindingNames: Set<string>;
  readonly subscribeFunctionNames: Set<string>;
}

const isListenerCollectionInitializer = (init: EsTreeNode | null | undefined): boolean => {
  if (!init) return false;
  if (isNodeOfType(init, "ArrayExpression")) return true;
  return (
    isNodeOfType(init, "NewExpression") &&
    isNodeOfType(init.callee, "Identifier") &&
    init.callee.name === "Set"
  );
};

const functionRegistersParameterIntoCollection = (
  functionNode: EsTreeNode,
  listenerCollectionNames: Set<string>,
): boolean => {
  if (!isFunctionLike(functionNode)) return false;
  const firstParam = functionNode.params?.[0];
  if (!isNodeOfType(firstParam, "Identifier")) return false;
  const listenerParamName = firstParam.name;
  let registersListener = false;
  walkAst(functionNode.body, (child: EsTreeNode) => {
    if (registersListener) return false;
    if (!isNodeOfType(child, "CallExpression")) return;
    if (!isNodeOfType(child.callee, "MemberExpression")) return;
    if (!isNodeOfType(child.callee.object, "Identifier")) return;
    if (!listenerCollectionNames.has(child.callee.object.name)) return;
    if (!isNodeOfType(child.callee.property, "Identifier")) return;
    if (child.callee.property.name !== "add" && child.callee.property.name !== "push") return;
    const registeredArgument = child.arguments?.[0];
    if (
      isNodeOfType(registeredArgument, "Identifier") &&
      registeredArgument.name === listenerParamName
    ) {
      registersListener = true;
    }
  });
  return registersListener;
};

const buildModuleScopeStoreIndex = (programRoot: EsTreeNode): ModuleScopeStoreIndex => {
  const mutableBindingNames = new Set<string>();
  const listenerCollectionNames = new Set<string>();
  const moduleFunctionsByName = new Map<string, EsTreeNode>();
  if (!isNodeOfType(programRoot, "Program")) {
    return { mutableBindingNames, subscribeFunctionNames: new Set() };
  }
  for (const statement of programRoot.body ?? []) {
    const unwrapped =
      isNodeOfType(statement, "ExportNamedDeclaration") && statement.declaration
        ? statement.declaration
        : statement;
    if (isNodeOfType(unwrapped, "FunctionDeclaration") && unwrapped.id) {
      moduleFunctionsByName.set(unwrapped.id.name, unwrapped);
      continue;
    }
    if (!isNodeOfType(unwrapped, "VariableDeclaration")) continue;
    for (const declarator of unwrapped.declarations ?? []) {
      if (!isNodeOfType(declarator.id, "Identifier")) continue;
      const init = declarator.init ?? null;
      if ((unwrapped.kind === "let" || unwrapped.kind === "var") && init && !isFunctionLike(init)) {
        mutableBindingNames.add(declarator.id.name);
        continue;
      }
      if (isListenerCollectionInitializer(init)) {
        listenerCollectionNames.add(declarator.id.name);
        continue;
      }
      if (init && isFunctionLike(init)) {
        moduleFunctionsByName.set(declarator.id.name, init);
      }
    }
  }
  const subscribeFunctionNames = new Set<string>();
  for (const [functionName, functionNode] of moduleFunctionsByName) {
    if (functionRegistersParameterIntoCollection(functionNode, listenerCollectionNames)) {
      subscribeFunctionNames.add(functionName);
    }
  }
  return { mutableBindingNames, subscribeFunctionNames };
};

// `useState(sharedState)` or `useState(() => sharedState)` where the
// identifier resolves to the module-scope binding (a component-local
// shadow of the same name must not match).
const getModuleStoreSnapshotName = (
  useStateCall: EsTreeNode,
  storeIndex: ModuleScopeStoreIndex,
): string | null => {
  if (!isNodeOfType(useStateCall, "CallExpression")) return null;
  let initialArgument = stripParenExpression(useStateCall.arguments?.[0]);
  if (
    initialArgument &&
    isFunctionLike(initialArgument) &&
    !isNodeOfType(initialArgument.body, "BlockStatement")
  ) {
    initialArgument = stripParenExpression(initialArgument.body);
  }
  if (!isNodeOfType(initialArgument, "Identifier")) return null;
  if (!storeIndex.mutableBindingNames.has(initialArgument.name)) return null;
  const binding = findVariableInitializer(initialArgument, initialArgument.name);
  if (!binding || !isNodeOfType(binding.scopeOwner, "Program")) return null;
  return initialArgument.name;
};

const argumentForwardsSetter = (argument: EsTreeNode | undefined, setterName: string): boolean => {
  if (!argument) return false;
  const unwrapped = stripParenExpression(argument);
  if (isNodeOfType(unwrapped, "Identifier")) return unwrapped.name === setterName;
  // `subscribe((next) => setS(next))` — a thin closure over the setter.
  if (!isFunctionLike(unwrapped)) return false;
  let callsSetter = false;
  walkAst(unwrapped.body, (child: EsTreeNode) => {
    if (
      isNodeOfType(child, "CallExpression") &&
      isNodeOfType(child.callee, "Identifier") &&
      child.callee.name === setterName
    ) {
      callsSetter = true;
      return false;
    }
  });
  return callsSetter;
};

const findModuleSubscribeCallForwardingSetter = (
  effectCallback: EsTreeNode,
  setterName: string,
  storeIndex: ModuleScopeStoreIndex,
): EsTreeNode | null => {
  let matchedCall: EsTreeNode | null = null;
  const callbackBody = isFunctionLike(effectCallback) ? effectCallback.body : null;
  walkAst(callbackBody ?? effectCallback, (child: EsTreeNode) => {
    if (matchedCall) return false;
    if (!isNodeOfType(child, "CallExpression")) return;
    if (!isNodeOfType(child.callee, "Identifier")) return;
    if (!storeIndex.subscribeFunctionNames.has(child.callee.name)) return;
    const binding = findVariableInitializer(child.callee, child.callee.name);
    if (!binding || !isNodeOfType(binding.scopeOwner, "Program")) return;
    for (const argument of child.arguments ?? []) {
      if (argumentForwardsSetter(argument, setterName)) {
        matchedCall = child;
        return false;
      }
    }
  });
  return matchedCall;
};

const cleanupReleasesSubscription = (
  effectBodyStatements: EsTreeNode[],
  boundReleaseName: string | null,
  boundSubscriptionName: string | null,
): boolean => {
  const lastStatement = effectBodyStatements[effectBodyStatements.length - 1];
  if (!isNodeOfType(lastStatement, "ReturnStatement")) return false;
  const knownBoundReleaseNames = new Set<string>();
  const knownBoundSubscriptionNames = new Set<string>();
  if (boundReleaseName) knownBoundReleaseNames.add(boundReleaseName);
  if (boundSubscriptionName) knownBoundSubscriptionNames.add(boundSubscriptionName);
  return isCleanupReturn(
    lastStatement.argument,
    knownBoundReleaseNames,
    knownBoundSubscriptionNames,
  );
};

export const preferUseSyncExternalStore = defineRule({
  id: "prefer-use-sync-external-store",
  title: "Hand-rolled external store subscription",
  tags: ["test-noise"],
  severity: "warn",
  recommendation:
    "Replace the `useState(getSnapshot())` + `useEffect(() => store.subscribe(() => setSnapshot(getSnapshot())))` pair with `useSyncExternalStore(store.subscribe, getSnapshot)`. The hook gets this right during concurrent rendering and on the server; the hand-rolled version doesn't.",
  create: (context: RuleContext) => {
    let cachedStoreIndex: ModuleScopeStoreIndex | null = null;
    const storeIndexFor = (node: EsTreeNode): ModuleScopeStoreIndex => {
      if (cachedStoreIndex) return cachedStoreIndex;
      const programRoot = findProgramRoot(node);
      cachedStoreIndex = programRoot
        ? buildModuleScopeStoreIndex(programRoot)
        : { mutableBindingNames: new Set(), subscribeFunctionNames: new Set() };
      return cachedStoreIndex;
    };

    const checkComponent = (componentBody: EsTreeNode | null | undefined): void => {
      if (!componentBody || !isNodeOfType(componentBody, "BlockStatement")) return;

      const useStateBindings = collectUseStateBindings(componentBody, context.scopes);
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

      for (const effectCall of findUseEffectsInComponent(componentBody, context.scopes)) {
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

        if (isTrivialLiteralExpression(setterPayload.setterArgument)) continue;

        if (
          !cleanupReleasesSubscription(
            effectBodyStatements,
            subscription.boundReleaseName,
            subscription.boundSubscriptionName,
          )
        ) {
          continue;
        }

        const matchingBinding = useStateBindings.find((binding) => binding.valueName === valueName);
        context.report({
          node: matchingBinding?.declarator ?? effectCall,
          message: `Your users can see stale or torn values because useState "${valueName}" syncs an outside store through a useEffect.`,
        });
      }

      checkModuleStoreShape(componentBody, useStateBindings);
    };

    const checkModuleStoreShape = (
      componentBody: EsTreeNode,
      useStateBindings: ReturnType<typeof collectUseStateBindings>,
    ): void => {
      const storeIndex = storeIndexFor(componentBody);
      if (storeIndex.mutableBindingNames.size === 0) return;
      if (storeIndex.subscribeFunctionNames.size === 0) return;

      const snapshotBindings = useStateBindings
        .map((binding) => ({
          binding,
          storeName: isNodeOfType(binding.declarator.init, "CallExpression")
            ? getModuleStoreSnapshotName(binding.declarator.init, storeIndex)
            : null,
        }))
        .filter(
          (candidate): candidate is typeof candidate & { storeName: string } =>
            candidate.storeName !== null,
        );
      if (snapshotBindings.length === 0) return;

      const reportedDeclarators = new Set<EsTreeNode>();
      for (const effectCall of findUseEffectsInComponent(componentBody, context.scopes)) {
        if (!isNodeOfType(effectCall, "CallExpression")) continue;
        if ((effectCall.arguments?.length ?? 0) < 2) continue;
        const depsNode = effectCall.arguments[1];
        if (!isNodeOfType(depsNode, "ArrayExpression")) continue;
        if ((depsNode.elements?.length ?? 0) !== 0) continue;

        const callback = getEffectCallback(effectCall);
        if (!callback || !isFunctionLike(callback)) continue;

        for (const { binding, storeName } of snapshotBindings) {
          if (reportedDeclarators.has(binding.declarator)) continue;
          const subscribeCall = findModuleSubscribeCallForwardingSetter(
            callback,
            binding.setterName,
            storeIndex,
          );
          if (!subscribeCall) continue;
          reportedDeclarators.add(binding.declarator);
          context.report({
            node: binding.declarator,
            message: `Your users can miss updates or see torn values because useState "${binding.valueName}" snapshots module store "${storeName}" at render but only subscribes later in a useEffect.`,
          });
        }
      }
    };

    return {
      // Custom hooks are the canonical host of the hand-rolled store shape
      // (the ground-truth `usePushSubscription` is a hook), so both
      // components and `use*` hooks are checked.
      FunctionDeclaration(node: EsTreeNodeOfType<"FunctionDeclaration">) {
        const functionName = node.id?.name;
        if (!functionName) return;
        if (!isUppercaseName(functionName) && !isReactHookName(functionName)) return;
        checkComponent(node.body);
      },
      VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
        const isHookAssignment =
          isNodeOfType(node.id, "Identifier") && isReactHookName(node.id.name);
        if (!isComponentAssignment(node) && !isHookAssignment) return;
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
