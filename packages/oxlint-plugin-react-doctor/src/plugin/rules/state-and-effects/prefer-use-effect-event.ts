import { TIMER_AND_SCHEDULER_DIRECT_CALLEE_NAMES } from "../../constants/dom.js";
import {
  EFFECT_HOOK_NAMES,
  REACT_HANDLER_PROP_PATTERN,
  SUBSCRIPTION_METHOD_NAMES,
} from "../../constants/react.js";
import { createComponentPropStackTracker } from "../../utils/create-component-prop-stack-tracker.js";
import { defineRule } from "../../utils/define-rule.js";
import { getCalleeName } from "../../utils/get-callee-name.js";
import { getEffectCallback } from "../../utils/get-effect-callback.js";
import { getFunctionBindingName } from "../../utils/get-function-binding-name.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { isReactApiCall } from "../../utils/is-react-api-call.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { symbolHasStableHookOrigin } from "../react-builtins/exhaustive-deps-symbol-stability.js";

const STABLE_REACT_HOOK_VALUE_NAMES: ReadonlySet<string> = new Set([
  "useActionState",
  "useEffectEvent",
  "useReducer",
  "useRef",
  "useState",
  "useTransition",
]);

const isStableReactHookDependency = (dependency: EsTreeNode, context: RuleContext): boolean => {
  const unwrappedDependency = stripParenExpression(dependency);
  if (!isNodeOfType(unwrappedDependency, "Identifier")) return false;

  const visitedSymbolIds = new Set<number>();
  let dependencySymbol = context.scopes.symbolFor(unwrappedDependency);
  while (dependencySymbol) {
    if (visitedSymbolIds.has(dependencySymbol.id)) return false;
    visitedSymbolIds.add(dependencySymbol.id);

    if (symbolHasStableHookOrigin(dependencySymbol, context.scopes)) {
      let declarator: EsTreeNode | null | undefined = dependencySymbol.declarationNode;
      while (declarator && !isNodeOfType(declarator, "VariableDeclarator")) {
        declarator = declarator.parent;
      }
      if (!declarator?.init) return false;
      const hookCall = stripParenExpression(declarator.init);
      return isReactApiCall(hookCall, STABLE_REACT_HOOK_VALUE_NAMES, context.scopes, {
        allowGlobalReactNamespace: true,
        resolveNamedAliases: true,
      });
    }

    if (
      dependencySymbol.kind !== "const" ||
      dependencySymbol.references.some((reference) => reference.flag !== "read") ||
      !isNodeOfType(dependencySymbol.declarationNode, "VariableDeclarator") ||
      dependencySymbol.declarationNode.id !== dependencySymbol.bindingIdentifier ||
      !dependencySymbol.initializer
    ) {
      return false;
    }
    const aliasInitializer = stripParenExpression(dependencySymbol.initializer);
    if (!isNodeOfType(aliasInitializer, "Identifier")) return false;
    dependencySymbol = context.scopes.symbolFor(aliasInitializer);
  }
  return false;
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
//         - a local declared via a potentially changing React `useCallback(...)`
//   (3) every read of `F` inside the effect body sits inside a sub-
//       handler (TIMER_AND_SCHEDULER_DIRECT_CALLEE_NAMES, OR a
//       MemberExpression whose property is in SUBSCRIPTION_METHOD_NAMES
//       — same set the prefer-use-sync-external-store family uses)
//   (4) `F` is NEVER read at the effect's own top level
const isPotentiallyChangingReactUseCallback = (
  initializer: EsTreeNode,
  context: RuleContext,
): boolean => {
  const unwrappedInitializer = stripParenExpression(initializer);
  if (!isNodeOfType(unwrappedInitializer, "CallExpression")) return false;
  if (
    !isReactApiCall(unwrappedInitializer, "useCallback", context.scopes, {
      allowGlobalReactNamespace: true,
      resolveNamedAliases: true,
    })
  ) {
    return false;
  }
  const dependencyList = unwrappedInitializer.arguments?.[1];
  if (!dependencyList) return true;
  const unwrappedDependencyList = stripParenExpression(dependencyList);
  if (!isNodeOfType(unwrappedDependencyList, "ArrayExpression")) return true;

  return (unwrappedDependencyList.elements ?? []).some(
    (dependency: EsTreeNode | null) =>
      dependency === null || !isStableReactHookDependency(dependency, context),
  );
};

const collectPotentiallyChangingCallbackBindings = (
  componentBody: EsTreeNode,
  context: RuleContext,
): Set<string> => {
  const potentiallyChangingCallbacks = new Set<string>();
  if (!isNodeOfType(componentBody, "BlockStatement")) return potentiallyChangingCallbacks;
  for (const statement of componentBody.body ?? []) {
    if (!isNodeOfType(statement, "VariableDeclaration")) continue;
    for (const declarator of statement.declarations ?? []) {
      if (!isNodeOfType(declarator.id, "Identifier")) continue;
      if (!declarator.init || !isPotentiallyChangingReactUseCallback(declarator.init, context))
        continue;
      potentiallyChangingCallbacks.add(declarator.id.name);
    }
  }
  return potentiallyChangingCallbacks;
};

const findEnclosingFunctionInsideEffect = (
  identifierNode: EsTreeNode,
  effectCallback: EsTreeNode,
): EsTreeNode | null => {
  let cursor: EsTreeNode | null = identifierNode.parent ?? null;
  while (cursor && cursor !== effectCallback) {
    if (
      isNodeOfType(cursor, "ArrowFunctionExpression") ||
      isNodeOfType(cursor, "FunctionExpression") ||
      isNodeOfType(cursor, "FunctionDeclaration")
    ) {
      return cursor;
    }
    cursor = cursor.parent ?? null;
  }
  return null;
};

const isCallExpressionWithSubHandlerCallee = (callExpression: EsTreeNode): boolean => {
  if (!isNodeOfType(callExpression, "CallExpression")) return false;
  const callee = callExpression.callee;
  if (
    isNodeOfType(callee, "Identifier") &&
    TIMER_AND_SCHEDULER_DIRECT_CALLEE_NAMES.has(callee.name)
  ) {
    return true;
  }
  if (
    isNodeOfType(callee, "MemberExpression") &&
    isNodeOfType(callee.property, "Identifier") &&
    SUBSCRIPTION_METHOD_NAMES.has(callee.property.name)
  ) {
    return true;
  }
  return false;
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
const findSubHandlerForEnclosingFunction = (
  enclosingFunction: EsTreeNode,
  effectCallback: EsTreeNode,
): EsTreeNode | null => {
  const directParent = enclosingFunction.parent;
  if (
    isNodeOfType(directParent, "CallExpression") &&
    (directParent.arguments ?? []).some((arg: EsTreeNode | null) => arg === enclosingFunction) &&
    isCallExpressionWithSubHandlerCallee(directParent)
  ) {
    return directParent;
  }

  const localName = getFunctionBindingName(enclosingFunction);
  if (localName === null) return null;

  let matchingSubHandlerCall: EsTreeNode | null = null;
  walkAst(effectCallback, (child: EsTreeNode) => {
    if (matchingSubHandlerCall) return false;
    if (!isNodeOfType(child, "CallExpression")) return;
    if (!isCallExpressionWithSubHandlerCallee(child)) return;
    for (const argument of child.arguments ?? []) {
      if (isNodeOfType(argument, "Identifier") && argument.name === localName) {
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
    if (!isNodeOfType(child, "Identifier")) return;
    if (child.name !== callableName) return;
    const parent = child.parent;
    if (isNodeOfType(parent, "ArrayExpression")) return;
    if (isNodeOfType(parent, "MemberExpression") && !parent.computed && parent.property === child) {
      return;
    }
    if (
      isNodeOfType(parent, "Property") &&
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
      firstSubHandlerName = getCalleeName(subHandlerCall);
    }
  });

  return { hasAnyRead, allReadsAreInSubHandlers, firstSubHandlerName };
};

export const preferUseEffectEvent = defineRule({
  id: "prefer-use-effect-event",
  title: "Effect re-subscribes on a changing callback",
  requires: ["react:19"],
  tags: ["test-noise"],
  severity: "warn",
  recommendation:
    "Wrap the callback with `useEffectEvent(callback)` (React 19+) and call it inside the sub-handler. An Effect Event always sees the latest props and state but isn't a dependency, so the effect won't re-subscribe every time the parent redraws. See https://react.dev/reference/react/useEffectEvent",
  create: (context: RuleContext) => {
    const checkComponent = (componentBody: EsTreeNode | undefined): void => {
      if (!componentBody || !isNodeOfType(componentBody, "BlockStatement")) return;
      const potentiallyChangingCallbackBindings = collectPotentiallyChangingCallbackBindings(
        componentBody,
        context,
      );

      for (const statement of componentBody.body ?? []) {
        if (!isNodeOfType(statement, "ExpressionStatement")) continue;
        const effectCall = statement.expression;
        if (!isNodeOfType(effectCall, "CallExpression")) continue;
        if (!isHookCall(effectCall, EFFECT_HOOK_NAMES)) continue;
        if ((effectCall.arguments?.length ?? 0) < 2) continue;

        const depsNode = effectCall.arguments[1];
        if (!isNodeOfType(depsNode, "ArrayExpression")) continue;
        const depElements = depsNode.elements ?? [];
        if (depElements.length < 2) continue;
        if (
          !depElements.every((element: EsTreeNode | null) => isNodeOfType(element, "Identifier"))
        ) {
          continue;
        }

        const callback = getEffectCallback(effectCall);
        if (!callback) continue;

        for (const depElement of depElements) {
          if (!isNodeOfType(depElement, "Identifier")) continue;
          const depName: string = depElement.name;
          // HACK: a destructured prop is treated as function-typed
          // ONLY if its name matches the React `on[A-Z]` callback
          // convention. Without this filter the rule false-positived
          // on scalar props.
          const isFunctionTypedPropDep =
            propStackTracker.isPropName(depName) && REACT_HANDLER_PROP_PATTERN.test(depName);
          const isFunctionTypedLocalDep = potentiallyChangingCallbackBindings.has(depName);
          if (!isFunctionTypedPropDep && !isFunctionTypedLocalDep) continue;

          const classification = classifyCallableReadsInsideEffect(depName, callback);
          if (!classification.hasAnyRead) continue;
          if (!classification.allReadsAreInSubHandlers) continue;

          const subHandlerLabel = classification.firstSubHandlerName
            ? `\`${classification.firstSubHandlerName}\``
            : "an async sub-handler";
          context.report({
            node: depElement,
            message: `Your effect re-subscribes whenever "${depName}" changes, even though it's only used inside ${subHandlerLabel}.`,
          });
        }
      }
    };

    const propStackTracker = createComponentPropStackTracker({
      onComponentEnter: checkComponent,
    });

    return propStackTracker.visitors;
  },
});
