import { TIMER_AND_SCHEDULER_DIRECT_CALLEE_NAMES } from "../../constants/dom.js";
import {
  EFFECT_HOOK_NAMES,
  REACT_HANDLER_PROP_PATTERN,
  SUBSCRIPTION_METHOD_NAMES,
} from "../../constants/react.js";
import { createComponentPropStackTracker } from "../../utils/create-component-prop-stack-tracker.js";
import { defineRule } from "../../utils/define-rule.js";
import { getEffectCallback } from "../../utils/get-effect-callback.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";

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
  if (!isNodeOfType(componentBody, "BlockStatement")) return functionTypedLocals;
  for (const statement of componentBody.body ?? []) {
    if (!isNodeOfType(statement, "VariableDeclaration")) continue;
    for (const declarator of statement.declarations ?? []) {
      if (!isNodeOfType(declarator.id, "Identifier")) continue;
      if (!isNodeOfType(declarator.init, "CallExpression")) continue;
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

const getSubHandlerCalleeName = (callExpression: EsTreeNode): string | null => {
  if (!isNodeOfType(callExpression, "CallExpression")) return null;
  const callee = callExpression.callee;
  if (isNodeOfType(callee, "Identifier")) return callee.name;
  if (isNodeOfType(callee, "MemberExpression") && isNodeOfType(callee.property, "Identifier")) {
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
    isNodeOfType(enclosingFunction, "FunctionDeclaration") &&
    isNodeOfType(enclosingFunction.id, "Identifier")
  ) {
    return enclosingFunction.id.name;
  }
  const directParent = enclosingFunction.parent;
  if (
    isNodeOfType(directParent, "VariableDeclarator") &&
    isNodeOfType(directParent.id, "Identifier")
  ) {
    return directParent.id.name;
  }
  if (
    isNodeOfType(directParent, "AssignmentExpression") &&
    directParent.right === enclosingFunction &&
    isNodeOfType(directParent.left, "Identifier")
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
    isNodeOfType(directParent, "CallExpression") &&
    (directParent.arguments ?? []).some((arg: EsTreeNode | null) => arg === enclosingFunction) &&
    isCallExpressionWithSubHandlerCallee(directParent)
  ) {
    return directParent;
  }

  const localName = getEnclosingFunctionBindingName(enclosingFunction);
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
      firstSubHandlerName = getSubHandlerCalleeName(subHandlerCall);
    }
  });

  return { hasAnyRead, allReadsAreInSubHandlers, firstSubHandlerName };
};

export const preferUseEffectEvent = defineRule<Rule>({
  id: "prefer-use-effect-event",
  requires: ["react:19"],
  tags: ["test-noise"],
  severity: "warn",
  recommendation:
    "Wrap the callback with `useEffectEvent(callback)` (React 19+) and call the resulting binding from inside the sub-handler. The Effect Event captures the latest props/state without being a reactive dep, so the effect doesn't re-subscribe on every parent render. See https://react.dev/reference/react/useEffectEvent",
  create: (context: RuleContext) => {
    const checkComponent = (componentBody: EsTreeNode | undefined): void => {
      if (!componentBody || !isNodeOfType(componentBody, "BlockStatement")) return;
      const functionTypedLocalBindings = collectFunctionTypedLocalBindings(componentBody);

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
});
