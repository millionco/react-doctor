import type { ScopeAnalysis, SymbolDescriptor } from "../../semantic/scope-analysis.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { findRenderPhaseComponentOrHook } from "../../utils/find-render-phase-component-or-hook.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import {
  functionReturnsMatchingExpression,
  functionReturnsMatchingExpressionOnEveryPathAfterNode,
} from "../../utils/function-returns-matching-expression.js";
import { getEffectCallback } from "../../utils/get-effect-callback.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveExactLocalFunction } from "../../utils/resolve-exact-local-function.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import { isR3fApiCall } from "./utils/is-r3f-api-call.js";
import { isR3fReactApiCall } from "./utils/is-r3f-react-api-call.js";
import { resolveR3fCallback } from "./utils/resolve-r3f-callback.js";
import { walkFunctionExecution } from "./utils/walk-function-execution.js";

const EFFECT_HOOK_NAMES = new Set(["useEffect", "useInsertionEffect", "useLayoutEffect"]);
const GLOBAL_EFFECT_API_NAMES = new Set(["addAfterEffect", "addEffect", "addTail"]);
const DEFERRED_CALLBACK_METHOD_NAMES = new Set(["catch", "finally", "then"]);

const isGlobalEffectRegistration = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  for (const apiName of GLOBAL_EFFECT_API_NAMES) {
    if (isR3fApiCall(node, apiName, scopes)) return true;
  }
  return false;
};

const collectExecutedRegistrations = (
  callback: EsTreeNode,
  scopes: ScopeAnalysis,
  includeDeferredCallbacks: boolean,
): Set<EsTreeNodeOfType<"CallExpression">> => {
  const registrations = new Set<EsTreeNodeOfType<"CallExpression">>();
  const visitedDeferredCallbacks = new Set<EsTreeNode>();
  const pendingCallbacks = [callback];
  while (pendingCallbacks.length > 0) {
    const currentCallback = pendingCallbacks.pop();
    if (!currentCallback || visitedDeferredCallbacks.has(currentCallback)) continue;
    visitedDeferredCallbacks.add(currentCallback);
    walkFunctionExecution(currentCallback, scopes, (candidate) => {
      if (
        isNodeOfType(candidate, "CallExpression") &&
        isGlobalEffectRegistration(candidate, scopes)
      ) {
        registrations.add(candidate);
      }
      if (
        !includeDeferredCallbacks ||
        !isNodeOfType(candidate, "CallExpression") ||
        !isNodeOfType(candidate.callee, "MemberExpression") ||
        !DEFERRED_CALLBACK_METHOD_NAMES.has(getStaticPropertyName(candidate.callee) ?? "")
      ) {
        return;
      }
      for (const argument of candidate.arguments) {
        if (isNodeOfType(argument, "SpreadElement")) continue;
        const deferredCallback = resolveExactLocalFunction(argument, scopes);
        if (deferredCallback) pendingCallbacks.push(deferredCallback);
      }
    });
  }
  return registrations;
};

const getCapturedDisposerSymbol = (
  registration: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
): SymbolDescriptor | null => {
  const expressionRoot = findTransparentExpressionRoot(registration);
  const parent = expressionRoot.parent;
  if (
    isNodeOfType(parent, "VariableDeclarator") &&
    parent.init === expressionRoot &&
    isNodeOfType(parent.id, "Identifier")
  ) {
    return scopes.symbolFor(parent.id);
  }
  if (
    isNodeOfType(parent, "AssignmentExpression") &&
    parent.operator === "=" &&
    parent.right === expressionRoot &&
    isNodeOfType(parent.left, "Identifier")
  ) {
    return scopes.symbolFor(parent.left);
  }
  return null;
};

const functionInvokesSymbol = (
  functionNode: EsTreeNode,
  symbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
): boolean => {
  let didInvokeSymbol = false;
  const invocationReachesSymbol = (
    invokedSymbol: SymbolDescriptor,
    visitedSymbolIds: Set<number>,
  ): boolean => {
    if (invokedSymbol.id === symbol.id) return true;
    if (visitedSymbolIds.has(invokedSymbol.id)) return false;
    visitedSymbolIds.add(invokedSymbol.id);
    const assignedFunctions: EsTreeNode[] = [];
    for (const reference of invokedSymbol.references) {
      if (reference.flag === "read") continue;
      const referenceRoot = findTransparentExpressionRoot(reference.identifier);
      const assignment = referenceRoot.parent;
      if (
        !isNodeOfType(assignment, "AssignmentExpression") ||
        assignment.operator !== "=" ||
        assignment.left !== referenceRoot
      ) {
        return false;
      }
      const assignedFunction = resolveExactLocalFunction(assignment.right, scopes);
      if (!assignedFunction) return false;
      assignedFunctions.push(assignedFunction);
    }
    return (
      assignedFunctions.length > 0 &&
      assignedFunctions.every((assignedFunction) => {
        let doesReachSymbol = false;
        walkFunctionExecution(assignedFunction, scopes, (candidate) => {
          if (doesReachSymbol || !isNodeOfType(candidate, "CallExpression")) return;
          const callee = stripParenExpression(candidate.callee);
          if (!isNodeOfType(callee, "Identifier")) return;
          const calleeSymbol = scopes.symbolFor(callee);
          if (calleeSymbol && invocationReachesSymbol(calleeSymbol, new Set(visitedSymbolIds))) {
            doesReachSymbol = true;
          }
        });
        return doesReachSymbol;
      })
    );
  };
  walkFunctionExecution(functionNode, scopes, (candidate) => {
    const callee = isNodeOfType(candidate, "CallExpression")
      ? stripParenExpression(candidate.callee)
      : null;
    if (!didInvokeSymbol && callee && isNodeOfType(callee, "Identifier")) {
      const calleeSymbol = scopes.symbolFor(callee);
      if (calleeSymbol && invocationReachesSymbol(calleeSymbol, new Set())) {
        didInvokeSymbol = true;
      }
    }
  });
  return didInvokeSymbol;
};

const isRegistrationReturnedWhenExecuted = (
  registration: EsTreeNode,
  effectCallback: EsTreeNode,
): boolean => {
  if (findEnclosingFunction(registration) !== effectCallback) return false;
  let current = findTransparentExpressionRoot(registration);
  while (current.parent && current.parent !== effectCallback) {
    const parent = current.parent;
    if (isNodeOfType(parent, "ReturnStatement") && parent.argument === current) return true;
    if (
      isNodeOfType(parent, "ConditionalExpression") &&
      (parent.consequent === current || parent.alternate === current)
    ) {
      current = parent;
      continue;
    }
    if (isNodeOfType(parent, "LogicalExpression") && parent.right === current) {
      current = parent;
      continue;
    }
    if (isNodeOfType(parent, "SequenceExpression") && parent.expressions.at(-1) === current) {
      current = parent;
      continue;
    }
    return false;
  }
  return isNodeOfType(effectCallback, "ArrowFunctionExpression") && effectCallback.body === current;
};

const effectReturnsRegistration = (
  effectCallback: EsTreeNode,
  registration: EsTreeNode,
  context: RuleContext,
): boolean =>
  isRegistrationReturnedWhenExecuted(registration, effectCallback) ||
  functionReturnsMatchingExpression(
    effectCallback,
    context.scopes,
    (expression) => expression === registration,
    context.cfg,
    "every",
  );

const effectReturnsCapturedCleanup = (
  effectCallback: EsTreeNode,
  registration: EsTreeNode,
  disposerSymbol: SymbolDescriptor,
  context: RuleContext,
): boolean => {
  const matchesCapturedCleanup = (expression: EsTreeNode): boolean => {
    if (
      isNodeOfType(expression, "Identifier") &&
      context.scopes.symbolFor(expression)?.id === disposerSymbol.id
    ) {
      return true;
    }
    const cleanupCallback = resolveExactLocalFunction(expression, context.scopes);
    return Boolean(
      cleanupCallback && functionInvokesSymbol(cleanupCallback, disposerSymbol, context.scopes),
    );
  };
  if (findEnclosingFunction(registration) !== effectCallback) {
    const registrationOwner = findEnclosingFunction(registration);
    if (!registrationOwner) return false;
    const registrationOwnerCalls: EsTreeNodeOfType<"CallExpression">[] = [];
    walkAst(effectCallback, (candidate) => {
      if (candidate !== effectCallback && isFunctionLike(candidate)) return false;
      if (!isNodeOfType(candidate, "CallExpression")) return;
      if (resolveExactLocalFunction(candidate.callee, context.scopes) === registrationOwner) {
        registrationOwnerCalls.push(candidate);
      }
    });
    if (registrationOwnerCalls.length === 0) {
      return functionReturnsMatchingExpression(
        effectCallback,
        context.scopes,
        matchesCapturedCleanup,
        context.cfg,
        "every",
      );
    }
    return registrationOwnerCalls.every((registrationOwnerCall) =>
      functionReturnsMatchingExpressionOnEveryPathAfterNode(
        effectCallback,
        registrationOwnerCall,
        context.scopes,
        matchesCapturedCleanup,
        context.cfg,
      ),
    );
  }
  return functionReturnsMatchingExpressionOnEveryPathAfterNode(
    effectCallback,
    registration,
    context.scopes,
    matchesCapturedCleanup,
    context.cfg,
  );
};

export const r3fRequireGlobalEffectCleanup = defineRule({
  id: "r3f-require-global-effect-cleanup",
  title: "Unreleased global R3F render-loop effect",
  category: "Correctness",
  severity: "warn",
  recommendation:
    "Register addEffect, addAfterEffect, and addTail from an effect and return the exact disposer so remounts do not retain global render-loop callbacks",
  create: (context: RuleContext) => {
    const reportedRegistrations = new Set<EsTreeNode>();
    const reportRegistration = (registration: EsTreeNode): void => {
      if (reportedRegistrations.has(registration)) return;
      reportedRegistrations.add(registration);
      context.report({
        node: registration,
        message:
          "This global R3F render-loop registration is not paired with its returned disposer. Return or invoke that exact disposer during React cleanup",
      });
    };

    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (isR3fReactApiCall(node, EFFECT_HOOK_NAMES, context.scopes)) {
          const effectCallback = getEffectCallback(node, context.scopes);
          if (!effectCallback) return;
          for (const registration of collectExecutedRegistrations(
            effectCallback,
            context.scopes,
            true,
          )) {
            if (effectReturnsRegistration(effectCallback, registration, context)) continue;
            const disposerSymbol = getCapturedDisposerSymbol(registration, context.scopes);
            if (
              disposerSymbol &&
              effectReturnsCapturedCleanup(effectCallback, registration, disposerSymbol, context)
            ) {
              continue;
            }
            reportRegistration(registration);
          }
          return;
        }

        const frameCallback = resolveR3fCallback(node, "useFrame", context.scopes);
        if (frameCallback) {
          for (const registration of collectExecutedRegistrations(
            frameCallback,
            context.scopes,
            false,
          )) {
            reportRegistration(registration);
          }
          return;
        }

        if (
          isGlobalEffectRegistration(node, context.scopes) &&
          findRenderPhaseComponentOrHook(node, context.scopes)
        ) {
          reportRegistration(node);
        }
      },
    };
  },
});
