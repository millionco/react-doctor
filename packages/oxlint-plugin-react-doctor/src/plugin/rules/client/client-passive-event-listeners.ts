import { PASSIVE_EVENT_NAMES } from "../../constants/dom.js";
import { defineRule } from "../../utils/define-rule.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { getDirectConstInitializer } from "../../utils/get-direct-const-initializer.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { createMethodMutationAnalysis } from "../../utils/has-proven-method-mutation.js";
import { getPropertyKeyName } from "../../utils/get-property-key-name.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isMemberProperty } from "../../utils/is-member-property.js";
import {
  getProvenDomEventTargetPrototypeOwnerNames,
  isProvenBrowserApiReceiver,
} from "../../utils/is-proven-browser-api-receiver.js";
import { isGeneratedDocsArchiveFilename } from "../../utils/is-generated-docs-archive-filename.js";
import { isProvenPureImportedPredicateCall } from "../../utils/is-proven-pure-imported-predicate-call.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { RuleVisitors } from "../../utils/rule-visitors.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { resolveMemberHandlerFunction } from "../../utils/resolve-member-handler-function.js";
import { walkAst } from "../../utils/walk-ast.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";

const DEFERRED_CALLBACK_API_NAMES = new Set([
  "queueMicrotask",
  "requestAnimationFrame",
  "requestIdleCallback",
  "setImmediate",
  "setInterval",
  "setTimeout",
]);
const PROMISE_FACTORY_METHOD_NAMES = new Set([
  "all",
  "allSettled",
  "any",
  "race",
  "reject",
  "resolve",
]);
const PROMISE_DEFERRED_METHOD_NAMES = new Set(["catch", "finally", "then"]);
const EMPTY_VISITORS: RuleVisitors = {};

// A handler that calls `event.preventDefault()` MUST run non-passively —
// passive listeners silently ignore preventDefault(). Recommending
// `{ passive: true }` here is exactly backwards (the rule's own
// recommendation says so), so an inline handler that calls
// preventDefault suppresses the report. Nested functions are pruned:
// a preventDefault inside a callback the handler merely creates runs
// outside the listener call, so it says nothing about this listener.
const handlerCallsPreventDefault = (handler: EsTreeNode | undefined): boolean => {
  if (!isFunctionLike(handler)) return false;
  let didFindPreventDefault = false;
  walkAst(handler, (child) => {
    if (didFindPreventDefault) return false;
    if (child !== handler && isFunctionLike(child)) return false;
    if (
      isNodeOfType(child, "CallExpression") &&
      isNodeOfType(child.callee, "MemberExpression") &&
      getStaticPropertyName(child.callee) === "preventDefault"
    ) {
      didFindPreventDefault = true;
    }
  });
  return didFindPreventDefault;
};

// Later writes to a `let` binding (`let onTouchMove; onTouchMove = (e) =>
// e.preventDefault()`) don't show up as the declarator initializer, so scan
// the binding's scope for plain assignments to the same name.
const assignedHandlerCallsPreventDefault = (
  scopeOwner: EsTreeNode,
  handlerName: string,
): boolean => {
  let didFindPreventDefault = false;
  walkAst(scopeOwner, (child) => {
    if (didFindPreventDefault) return false;
    if (
      isNodeOfType(child, "AssignmentExpression") &&
      child.operator === "=" &&
      isNodeOfType(child.left, "Identifier") &&
      child.left.name === handlerName &&
      handlerCallsPreventDefault(child.right)
    ) {
      didFindPreventDefault = true;
    }
  });
  return didFindPreventDefault;
};

// Handlers are usually passed by reference inside an effect (`const onTouchMove
// = (e) => { e.preventDefault(); … }; el.addEventListener("touchmove",
// onTouchMove)`) so they can be removed in cleanup. Resolve the binding so the
// preventDefault escape hatch also covers the referenced form — otherwise the
// rule would recommend `{ passive: true }`, which silently breaks
// preventDefault().
const handlerArgumentCallsPreventDefault = (handler: EsTreeNode | undefined): boolean => {
  if (!handler) return false;
  if (handlerCallsPreventDefault(handler)) return true;
  if (isNodeOfType(handler, "Identifier")) {
    const binding = findVariableInitializer(handler, handler.name);
    if (!binding) return false;
    if (handlerCallsPreventDefault(binding.initializer ?? undefined)) return true;
    return assignedHandlerCallsPreventDefault(binding.scopeOwner, handler.name);
  }
  if (isNodeOfType(handler, "MemberExpression")) {
    const resolved = resolveMemberHandlerFunction(handler);
    return resolved ? handlerCallsPreventDefault(resolved) : false;
  }
  return false;
};

const resolveHandlerFunction = (
  handler: EsTreeNode | undefined,
  context: RuleContext,
): EsTreeNode | undefined => {
  if (!handler) return undefined;
  const unwrappedHandler = stripParenExpression(handler);
  if (isFunctionLike(unwrappedHandler)) return unwrappedHandler;
  if (isNodeOfType(unwrappedHandler, "Identifier")) {
    const symbol = context.scopes.symbolFor(unwrappedHandler);
    const candidate = symbol?.initializer ?? symbol?.declarationNode;
    if (candidate && isFunctionLike(candidate)) return candidate;
    const binding = findVariableInitializer(unwrappedHandler, unwrappedHandler.name);
    let assignedFunction: EsTreeNode | undefined;
    if (symbol && binding) {
      walkAst(binding.scopeOwner, (child) => {
        if (child.range[0] >= unwrappedHandler.range[0]) return false;
        if (
          isNodeOfType(child, "AssignmentExpression") &&
          child.operator === "=" &&
          isNodeOfType(child.left, "Identifier") &&
          context.scopes.symbolFor(child.left) === symbol
        ) {
          const assignedValue = stripParenExpression(child.right);
          assignedFunction = isFunctionLike(assignedValue) ? assignedValue : undefined;
        }
      });
    }
    return assignedFunction;
  }
  return isNodeOfType(unwrappedHandler, "MemberExpression")
    ? resolveMemberHandlerFunction(unwrappedHandler)
    : undefined;
};

const isImportedPredicateCall = (
  callExpression: EsTreeNode,
  eventArgumentIndex: number,
  context: RuleContext,
): boolean => {
  if (!isProvenPureImportedPredicateCall(callExpression, eventArgumentIndex, context)) {
    return false;
  }
  let expression: EsTreeNode = callExpression;
  while (expression.parent) {
    const parent: EsTreeNode = expression.parent;
    if (
      stripParenExpression(parent) === expression ||
      (isNodeOfType(parent, "UnaryExpression") && parent.operator === "!") ||
      isNodeOfType(parent, "LogicalExpression")
    ) {
      expression = parent;
      continue;
    }
    return (
      (isNodeOfType(parent, "IfStatement") && parent.test === expression) ||
      (isNodeOfType(parent, "ConditionalExpression") && parent.test === expression) ||
      (isNodeOfType(parent, "WhileStatement") && parent.test === expression) ||
      (isNodeOfType(parent, "DoWhileStatement") && parent.test === expression) ||
      (isNodeOfType(parent, "ForStatement") && parent.test === expression)
    );
  }
  return false;
};

const handlerMayExposeEvent = (handler: EsTreeNode | undefined, context: RuleContext): boolean => {
  const rootFunction = resolveHandlerFunction(handler, context);
  if (!rootFunction) {
    const unwrappedHandler = handler ? stripParenExpression(handler) : undefined;
    if (!unwrappedHandler || !isNodeOfType(unwrappedHandler, "Identifier")) return false;
    const symbol = context.scopes.symbolFor(unwrappedHandler);
    return Boolean(
      symbol &&
      (symbol.kind === "let" || symbol.kind === "var") &&
      symbol.references.some(
        (reference) =>
          reference.identifier.range[0] < unwrappedHandler.range[0] && reference.flag !== "read",
      ),
    );
  }
  const visitedParameterIndexesByFunction = new Map<EsTreeNode, Set<number>>();

  const isAsyncFunctionReference = (
    rawExpression: EsTreeNode,
    visitedSymbolIds: Set<number>,
  ): boolean => {
    const expression = stripParenExpression(rawExpression);
    if (isFunctionLike(expression)) return expression.async;
    if (!isNodeOfType(expression, "Identifier")) return false;
    const symbol = context.scopes.symbolFor(expression);
    if (!symbol || visitedSymbolIds.has(symbol.id)) return false;
    const candidate = symbol.initializer ?? symbol.declarationNode;
    if (!candidate) return false;
    const nextVisitedSymbolIds = new Set(visitedSymbolIds);
    nextVisitedSymbolIds.add(symbol.id);
    return isAsyncFunctionReference(candidate, nextVisitedSymbolIds);
  };

  const isProvenPromiseExpression = (
    rawExpression: EsTreeNode,
    visitedSymbolIds: Set<number> = new Set(),
  ): boolean => {
    const expression = stripParenExpression(rawExpression);
    if (isNodeOfType(expression, "Identifier")) {
      const symbol = context.scopes.symbolFor(expression);
      if (!symbol || visitedSymbolIds.has(symbol.id)) return false;
      const initializer = symbol.initializer;
      if (!initializer) return false;
      const nextVisitedSymbolIds = new Set(visitedSymbolIds);
      nextVisitedSymbolIds.add(symbol.id);
      return isProvenPromiseExpression(initializer, nextVisitedSymbolIds);
    }
    if (isNodeOfType(expression, "NewExpression")) {
      const callee = stripParenExpression(expression.callee);
      return (
        isNodeOfType(callee, "Identifier") &&
        callee.name === "Promise" &&
        context.scopes.isGlobalReference(callee)
      );
    }
    if (!isNodeOfType(expression, "CallExpression")) return false;
    const callee = stripParenExpression(expression.callee);
    if (isNodeOfType(callee, "Identifier")) {
      return isAsyncFunctionReference(callee, visitedSymbolIds);
    }
    if (!isNodeOfType(callee, "MemberExpression")) return false;
    const calleeObject = stripParenExpression(callee.object);
    if (PROMISE_DEFERRED_METHOD_NAMES.has(getStaticPropertyName(callee) ?? "")) {
      return isProvenPromiseExpression(callee.object, visitedSymbolIds);
    }
    return (
      PROMISE_FACTORY_METHOD_NAMES.has(getStaticPropertyName(callee) ?? "") &&
      isNodeOfType(calleeObject, "Identifier") &&
      calleeObject.name === "Promise" &&
      context.scopes.isGlobalReference(calleeObject)
    );
  };

  const isProvenDeferredCallbackCallee = (
    rawCallee: EsTreeNode,
    visitedSymbolIds: Set<number> = new Set(),
  ): boolean => {
    const callee = stripParenExpression(rawCallee);
    if (isNodeOfType(callee, "Identifier")) {
      if (
        DEFERRED_CALLBACK_API_NAMES.has(callee.name) &&
        context.scopes.isGlobalReference(callee)
      ) {
        return true;
      }
      const symbol = context.scopes.symbolFor(callee);
      if (!symbol || visitedSymbolIds.has(symbol.id)) return false;
      const initializer = getDirectConstInitializer(symbol);
      if (!initializer) return false;
      const nextVisitedSymbolIds = new Set(visitedSymbolIds);
      nextVisitedSymbolIds.add(symbol.id);
      return isProvenDeferredCallbackCallee(initializer, nextVisitedSymbolIds);
    }
    if (!isNodeOfType(callee, "MemberExpression")) return false;
    const calleeObject = stripParenExpression(callee.object);
    return (
      DEFERRED_CALLBACK_API_NAMES.has(getStaticPropertyName(callee) ?? "") &&
      isNodeOfType(calleeObject, "Identifier") &&
      (calleeObject.name === "window" || calleeObject.name === "globalThis") &&
      context.scopes.isGlobalReference(calleeObject)
    );
  };

  const shouldVisitNestedFunction = (functionNode: EsTreeNode): boolean => {
    let expression = functionNode;
    while (
      expression.parent &&
      stripParenExpression(expression.parent) === stripParenExpression(expression)
    ) {
      expression = expression.parent;
    }
    const callExpression = expression.parent;
    if (isNodeOfType(callExpression, "NewExpression")) {
      const callee = stripParenExpression(callExpression.callee);
      return (
        callExpression.arguments.some((argument) => argument === expression) &&
        isNodeOfType(callee, "Identifier") &&
        callee.name === "Promise" &&
        context.scopes.isGlobalReference(callee)
      );
    }
    if (!isNodeOfType(callExpression, "CallExpression")) return false;
    if (stripParenExpression(callExpression.callee) === stripParenExpression(expression))
      return true;
    if (!callExpression.arguments.some((argument) => argument === expression)) return false;
    const callee = stripParenExpression(callExpression.callee);
    if (isProvenDeferredCallbackCallee(callee)) return false;
    if (isNodeOfType(callee, "Identifier")) return true;
    if (!isNodeOfType(callee, "MemberExpression")) return true;
    const methodName = getStaticPropertyName(callee);
    if (
      PROMISE_DEFERRED_METHOD_NAMES.has(methodName ?? "") &&
      isProvenPromiseExpression(callee.object)
    ) {
      return false;
    }
    if (
      methodName === "addEventListener" &&
      isProvenBrowserApiReceiver(callee.object, "dom-event-target", context.scopes)
    ) {
      return false;
    }
    return true;
  };

  const functionMayExposeParameter = (
    functionNode: EsTreeNode,
    parameterIndex: number,
    isRootHandler = false,
  ): boolean => {
    if (!isFunctionLike(functionNode)) return false;
    const visitedParameterIndexes =
      visitedParameterIndexesByFunction.get(functionNode) ?? new Set();
    if (visitedParameterIndexes.has(parameterIndex)) return false;
    visitedParameterIndexes.add(parameterIndex);
    visitedParameterIndexesByFunction.set(functionNode, visitedParameterIndexes);
    const rawParameter = functionNode.params[parameterIndex];
    if (!rawParameter) return !isRootHandler;
    const parameter = isNodeOfType(rawParameter, "AssignmentPattern")
      ? rawParameter.left
      : rawParameter;
    if (!isNodeOfType(parameter, "Identifier")) {
      return !(isRootHandler && isNodeOfType(parameter, "ObjectPattern"));
    }
    const parameterSymbol = context.scopes.symbolFor(parameter);
    if (!parameterSymbol) return false;
    const parameterAliasSymbols = new Set([parameterSymbol]);
    const parameterContainerAliasSymbols = new Set<typeof parameterSymbol>();
    const isParameterAlias = (candidate: EsTreeNode): boolean => {
      const unwrappedCandidate = stripParenExpression(candidate);
      if (!isNodeOfType(unwrappedCandidate, "Identifier")) return false;
      const candidateSymbol = context.scopes.symbolFor(unwrappedCandidate);
      return Boolean(candidateSymbol && parameterAliasSymbols.has(candidateSymbol));
    };
    const expressionContainsParameterAlias: (candidate: EsTreeNode) => boolean = (candidate) => {
      const expression = stripParenExpression(candidate);
      if (isParameterAlias(expression)) return true;
      if (isNodeOfType(expression, "SpreadElement")) {
        return expressionContainsParameterAlias(expression.argument);
      }
      if (isNodeOfType(expression, "MemberExpression")) {
        const memberObject = stripParenExpression(expression.object);
        if (isNodeOfType(memberObject, "Identifier")) {
          const objectSymbol = context.scopes.symbolFor(memberObject);
          if (objectSymbol && parameterContainerAliasSymbols.has(objectSymbol)) return true;
        }
        const propertyName = getStaticPropertyName(expression);
        if (isNodeOfType(memberObject, "ObjectExpression") && propertyName) {
          const property = memberObject.properties.find(
            (candidate) =>
              isNodeOfType(candidate, "Property") &&
              getPropertyKeyName(candidate.key) === propertyName,
          );
          return Boolean(
            isNodeOfType(property, "Property") && expressionContainsParameterAlias(property.value),
          );
        }
        if (
          isNodeOfType(memberObject, "ArrayExpression") &&
          isNodeOfType(expression.property, "Literal") &&
          typeof expression.property.value === "number"
        ) {
          const element = memberObject.elements[expression.property.value];
          return Boolean(element && expressionContainsParameterAlias(element));
        }
        return false;
      }
      if (isNodeOfType(expression, "ObjectExpression")) {
        return expression.properties.some((property) =>
          isNodeOfType(property, "Property")
            ? expressionContainsParameterAlias(property.value)
            : isNodeOfType(property, "SpreadElement") &&
              expressionContainsParameterAlias(property.argument),
        );
      }
      if (isNodeOfType(expression, "ArrayExpression")) {
        return expression.elements.some(
          (element) => element && expressionContainsParameterAlias(element),
        );
      }
      if (isNodeOfType(expression, "ConditionalExpression")) {
        return (
          expressionContainsParameterAlias(expression.consequent) ||
          expressionContainsParameterAlias(expression.alternate)
        );
      }
      if (isNodeOfType(expression, "LogicalExpression")) {
        return (
          expressionContainsParameterAlias(expression.left) ||
          expressionContainsParameterAlias(expression.right)
        );
      }
      if (isNodeOfType(expression, "SequenceExpression")) {
        return expression.expressions.some(expressionContainsParameterAlias);
      }
      return false;
    };
    const addAliasesFromPattern = (pattern: EsTreeNode, rawSource: EsTreeNode): void => {
      const source = stripParenExpression(rawSource);
      if (isNodeOfType(pattern, "Identifier")) {
        if (!expressionContainsParameterAlias(source)) return;
        const aliasSymbol = context.scopes.symbolFor(pattern);
        if (aliasSymbol) parameterAliasSymbols.add(aliasSymbol);
        return;
      }
      if (isNodeOfType(pattern, "AssignmentPattern")) {
        addAliasesFromPattern(pattern.left, source);
        return;
      }
      if (isNodeOfType(pattern, "RestElement") && isNodeOfType(pattern.argument, "Identifier")) {
        if (!expressionContainsParameterAlias(source)) return;
        const aliasSymbol = context.scopes.symbolFor(pattern.argument);
        if (aliasSymbol) parameterContainerAliasSymbols.add(aliasSymbol);
        return;
      }
      if (isNodeOfType(pattern, "ObjectPattern") && isNodeOfType(source, "ObjectExpression")) {
        for (const patternProperty of pattern.properties) {
          if (isNodeOfType(patternProperty, "RestElement")) {
            addAliasesFromPattern(patternProperty, source);
            continue;
          }
          if (!isNodeOfType(patternProperty, "Property")) continue;
          const propertyName = getPropertyKeyName(patternProperty.key);
          if (!propertyName) continue;
          const sourceProperty = source.properties.find(
            (property) =>
              isNodeOfType(property, "Property") &&
              getPropertyKeyName(property.key) === propertyName,
          );
          if (isNodeOfType(sourceProperty, "Property")) {
            addAliasesFromPattern(patternProperty.value, sourceProperty.value);
          }
        }
        return;
      }
      if (isNodeOfType(pattern, "ArrayPattern") && isNodeOfType(source, "ArrayExpression")) {
        for (const [elementIndex, patternElement] of pattern.elements.entries()) {
          const sourceElement = source.elements[elementIndex];
          if (patternElement && sourceElement) addAliasesFromPattern(patternElement, sourceElement);
        }
      }
    };
    let didExposeEvent = false;
    walkAst(functionNode.body, (child) => {
      if (didExposeEvent) return false;
      if (
        child !== functionNode.body &&
        isFunctionLike(child) &&
        !shouldVisitNestedFunction(child)
      ) {
        return false;
      }
      if (isNodeOfType(child, "VariableDeclarator") && child.init) {
        addAliasesFromPattern(child.id, child.init);
        return;
      }
      if (
        isNodeOfType(child, "AssignmentExpression") &&
        expressionContainsParameterAlias(child.right)
      ) {
        if (isNodeOfType(child.left, "Identifier")) {
          const aliasSymbol = context.scopes.symbolFor(child.left);
          if (aliasSymbol) parameterAliasSymbols.add(aliasSymbol);
        } else {
          didExposeEvent = true;
        }
        return;
      }
      if (isNodeOfType(child, "AssignmentExpression")) {
        const assignmentTarget = stripParenExpression(child.left);
        const assignmentValue = stripParenExpression(child.right);
        if (
          isNodeOfType(assignmentTarget, "MemberExpression") &&
          getStaticPropertyName(assignmentTarget) === "returnValue" &&
          isParameterAlias(assignmentTarget.object) &&
          isNodeOfType(assignmentValue, "Literal") &&
          assignmentValue.value === false
        ) {
          didExposeEvent = true;
          return;
        }
      }
      if (
        isNodeOfType(child, "ReturnStatement") &&
        child.argument &&
        expressionContainsParameterAlias(child.argument)
      ) {
        didExposeEvent = true;
        return;
      }
      if (isNodeOfType(child, "NewExpression")) {
        if (
          child.arguments.some(
            (argument) =>
              !isNodeOfType(argument, "SpreadElement") &&
              expressionContainsParameterAlias(argument),
          )
        ) {
          didExposeEvent = true;
        }
        return;
      }
      if (!isNodeOfType(child, "CallExpression")) return;
      const childCallee = stripParenExpression(child.callee);
      if (
        isNodeOfType(childCallee, "MemberExpression") &&
        getStaticPropertyName(childCallee) === "preventDefault" &&
        isParameterAlias(childCallee.object)
      ) {
        didExposeEvent = true;
        return;
      }
      const eventArgumentIndex = child.arguments.findIndex((argument) => {
        return expressionContainsParameterAlias(argument);
      });
      if (eventArgumentIndex < 0) return;
      const calledFunction = resolveHandlerFunction(child.callee, context);
      if (
        (!calledFunction && !isImportedPredicateCall(child, eventArgumentIndex, context)) ||
        (calledFunction && functionMayExposeParameter(calledFunction, eventArgumentIndex))
      ) {
        didExposeEvent = true;
      }
      return;
    });
    return didExposeEvent;
  };

  return functionMayExposeParameter(rootFunction, 0, true);
};

// An explicit `{ passive: false }` is a deliberate opt-out (the author
// needs preventDefault to work). Treat it like `passive: true` for the
// purposes of this rule: not a forgotten passive flag.
const hasExplicitPassiveValue = (
  optionsArgument: EsTreeNodeOfType<"ObjectExpression">,
  expected: boolean,
): boolean =>
  Boolean(
    optionsArgument.properties?.some(
      (property: EsTreeNode) =>
        isNodeOfType(property, "Property") &&
        isNodeOfType(property.key, "Identifier") &&
        property.key.name === "passive" &&
        isNodeOfType(property.value, "Literal") &&
        property.value.value === expected,
    ),
  );

export const clientPassiveEventListeners = defineRule({
  id: "client-passive-event-listeners",
  title: "Non-passive scroll listener",
  tags: ["test-noise"],
  severity: "warn",
  recommendation:
    "Add `{ passive: true }` as the third argument: `addEventListener('touchmove', handler, { passive: true })`. Only do this if the handler doesn't call `event.preventDefault()`, since passive listeners ignore it (which breaks pull-to-refresh, custom gestures, and nested scrolling).",
  create: (context: RuleContext) => {
    if (isGeneratedDocsArchiveFilename(context.filename)) return EMPTY_VISITORS;
    const methodMutationAnalysis = createMethodMutationAnalysis(context);
    const addEventListenerCalls: EsTreeNodeOfType<"CallExpression">[] = [];
    const callsPreventDefaultByHandler = new WeakMap<EsTreeNode, boolean>();
    const exposesEventByHandler = new WeakMap<EsTreeNode, boolean>();
    const analyzeAddEventListenerCall = (node: EsTreeNodeOfType<"CallExpression">): void => {
      const callee = stripParenExpression(node.callee);
      if (!isMemberProperty(callee, "addEventListener")) return;
      if (!isProvenBrowserApiReceiver(callee.object, "dom-event-target", context.scopes)) return;
      if (
        methodMutationAnalysis.hasProvenMutation(
          callee.object,
          "addEventListener",
          node,
          getProvenDomEventTargetPrototypeOwnerNames(callee.object, context.scopes),
          (replacement) =>
            isProvenBrowserApiReceiver(replacement, "dom-event-target", context.scopes),
        )
      ) {
        return;
      }
      if (node.arguments.length < 2) return;

      const eventNameNode = node.arguments[0];
      if (
        !isNodeOfType(eventNameNode, "Literal") ||
        typeof eventNameNode.value !== "string" ||
        !PASSIVE_EVENT_NAMES.has(eventNameNode.value)
      ) {
        return;
      }

      const eventName = eventNameNode.value;
      const handlerArgument = node.arguments[1];
      if (!handlerArgument || isNodeOfType(handlerArgument, "SpreadElement")) return;
      const handlerCacheKey = resolveHandlerFunction(handlerArgument, context) ?? handlerArgument;
      let doesHandlerCallPreventDefault = callsPreventDefaultByHandler.get(handlerCacheKey);
      if (doesHandlerCallPreventDefault === undefined) {
        doesHandlerCallPreventDefault = handlerArgumentCallsPreventDefault(handlerArgument);
        callsPreventDefaultByHandler.set(handlerCacheKey, doesHandlerCallPreventDefault);
      }
      if (doesHandlerCallPreventDefault) return;
      let doesHandlerExposeEvent = exposesEventByHandler.get(handlerCacheKey);
      if (doesHandlerExposeEvent === undefined) {
        doesHandlerExposeEvent = handlerMayExposeEvent(handlerArgument, context);
        exposesEventByHandler.set(handlerCacheKey, doesHandlerExposeEvent);
      }
      if (doesHandlerExposeEvent) return;

      const optionsArgument = node.arguments[2];
      if (optionsArgument) {
        if (!isNodeOfType(optionsArgument, "ObjectExpression")) return;
        if (
          hasExplicitPassiveValue(optionsArgument, false) ||
          hasExplicitPassiveValue(optionsArgument, true)
        ) {
          return;
        }
      }
      context.report({
        node,
        message: `"${eventName}" listener without { passive: true } makes scrolling janky for your users. Only add it if the handler doesn't call event.preventDefault(), since passive listeners silently ignore preventDefault().`,
      });
    };
    return {
      AssignmentExpression(node: EsTreeNode) {
        methodMutationAnalysis.record(node);
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        methodMutationAnalysis.record(node);
        const callee = stripParenExpression(node.callee);
        if (!isMemberProperty(callee, "addEventListener")) return;
        addEventListenerCalls.push(node);
      },
      UnaryExpression(node: EsTreeNode) {
        methodMutationAnalysis.record(node);
      },
      "Program:exit"() {
        for (const node of addEventListenerCalls) analyzeAddEventListenerCall(node);
      },
    };
  },
});
