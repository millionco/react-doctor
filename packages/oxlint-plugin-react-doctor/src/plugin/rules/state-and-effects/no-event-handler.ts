import type { Reference } from "eslint-scope";
import { TIMER_AND_SCHEDULER_DIRECT_CALLEE_NAMES } from "../../constants/dom.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getRootIdentifier } from "../../utils/get-root-identifier.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactHookCall } from "../../utils/is-react-hook-call.js";
import { resolveReactRefSymbol } from "../../utils/react-ref-origin.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import { collectBoundedEffectExecutionFrames } from "./utils/collect-effect-state-write-facts.js";
import { getDownstreamRefs, getRef, getUpstreamRefs } from "./utils/effect/ast.js";
import { getProgramAnalysis, type ProgramAnalysis } from "./utils/effect/get-program-analysis.js";
import {
  hasCleanup,
  isPropCallbackInvocationRef,
  isProp,
  isState,
  isStateSetterCall,
  getUseStateDecl,
} from "./utils/effect/react.js";
import { findTriggeredSideEffectCalleeName } from "./utils/find-triggered-side-effect-callee-name.js";
import { isStateWrittenOnlyFromEventHandlers } from "./utils/is-state-written-only-from-event-handlers.js";

const collectGuardStateReferences = (
  analysis: ProgramAnalysis,
  testExpression: EsTreeNode,
): ReadonlyArray<Reference> => {
  const stateReferences: Reference[] = [];
  const seenBindings = new Set<unknown>();
  for (const directReference of getDownstreamRefs(analysis, testExpression)) {
    for (const reference of getUpstreamRefs(analysis, directReference)) {
      if (!isState(analysis, reference)) continue;
      const binding = reference.resolved ?? reference.identifier;
      if (seenBindings.has(binding)) continue;
      seenBindings.add(binding);
      stateReferences.push(reference);
    }
  }
  return stateReferences;
};

const findReactRefSymbolInMemberChain = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
): ReturnType<typeof resolveReactRefSymbol> => {
  let currentExpression = stripParenExpression(expression);
  while (isNodeOfType(currentExpression, "MemberExpression")) {
    const refSymbol = resolveReactRefSymbol(currentExpression, scopes, {
      allowUnboundBareCalls: true,
      resolveNamedAliases: true,
    });
    if (refSymbol) return refSymbol;
    currentExpression = stripParenExpression(currentExpression.object as EsTreeNode);
  }
  return null;
};

const isReactRefMemberCall = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
  memberName: string,
  scopes: ScopeAnalysis,
): boolean => {
  const callee = stripParenExpression(callExpression.callee);
  if (!isNodeOfType(callee, "MemberExpression") || getStaticPropertyName(callee) !== memberName) {
    return false;
  }
  return findReactRefSymbolInMemberChain(callee, scopes) !== null;
};

const isCollectionRefMutation = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
): boolean => {
  const callee = stripParenExpression(callExpression.callee);
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  const memberName = getStaticPropertyName(callee);
  if (!memberName) return false;
  const refSymbol = findReactRefSymbolInMemberChain(callee, scopes);
  const refCall = refSymbol?.initializer ? stripParenExpression(refSymbol.initializer) : null;
  const initialValue =
    refCall && isNodeOfType(refCall, "CallExpression") && refCall.arguments?.[0]
      ? stripParenExpression(refCall.arguments[0] as EsTreeNode)
      : null;
  if (
    !initialValue ||
    !isNodeOfType(initialValue, "NewExpression") ||
    !isNodeOfType(initialValue.callee, "Identifier") ||
    !scopes.isGlobalReference(initialValue.callee)
  ) {
    return false;
  }
  if (initialValue.callee.name === "Map") {
    return memberName === "set" || memberName === "delete" || memberName === "clear";
  }
  if (initialValue.callee.name === "Set") {
    return memberName === "add" || memberName === "delete" || memberName === "clear";
  }
  return false;
};

const getSchedulerName = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
): string | null => {
  const callee = stripParenExpression(callExpression.callee);
  if (
    isNodeOfType(callee, "Identifier") &&
    scopes.isGlobalReference(callee) &&
    TIMER_AND_SCHEDULER_DIRECT_CALLEE_NAMES.has(callee.name)
  ) {
    return callee.name;
  }
  if (!isNodeOfType(callee, "MemberExpression")) return null;
  const memberName = getStaticPropertyName(callee);
  if (!memberName || !TIMER_AND_SCHEDULER_DIRECT_CALLEE_NAMES.has(memberName)) return null;
  const rootIdentifier = getRootIdentifier(callee);
  return rootIdentifier &&
    (rootIdentifier.name === "globalThis" ||
      rootIdentifier.name === "self" ||
      rootIdentifier.name === "window") &&
    scopes.isGlobalReference(rootIdentifier)
    ? memberName
    : null;
};

const isDeferredRefFocusSynchronization = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
): boolean => {
  if (!getSchedulerName(callExpression, scopes)) return false;
  const callback = callExpression.arguments?.[0] as EsTreeNode | undefined;
  if (!isFunctionLike(callback)) return false;
  const callbackBody = stripParenExpression(callback.body as EsTreeNode);
  if (isNodeOfType(callbackBody, "CallExpression")) {
    return isReactRefMemberCall(callbackBody, "focus", scopes);
  }
  if (!isNodeOfType(callbackBody, "BlockStatement") || callbackBody.body.length !== 1) return false;
  const statement = callbackBody.body[0] as EsTreeNode;
  return (
    isNodeOfType(statement, "ExpressionStatement") &&
    isNodeOfType(statement.expression, "CallExpression") &&
    isReactRefMemberCall(statement.expression, "focus", scopes)
  );
};

const consequentHasTransferableWork = (
  analysis: ProgramAnalysis,
  consequent: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (
    getDownstreamRefs(analysis, consequent).some((reference) =>
      isPropCallbackInvocationRef(analysis, reference),
    )
  ) {
    return true;
  }
  let hasTransferableWork = false;
  walkAst(consequent, (child: EsTreeNode): boolean | void => {
    if (hasTransferableWork) return false;
    if (child !== consequent && isFunctionLike(child)) return false;
    if (!isNodeOfType(child, "CallExpression")) return;
    if (
      isDeferredRefFocusSynchronization(child, scopes) ||
      isCollectionRefMutation(child, scopes)
    ) {
      return;
    }
    if (findTriggeredSideEffectCalleeName(child)) {
      hasTransferableWork = true;
      return false;
    }
    if (isNodeOfType(child.callee, "Identifier")) {
      const calleeReference = getRef(analysis, child.callee);
      if (calleeReference && isStateSetterCall(analysis, calleeReference)) return;
      const isCustomHookResult = calleeReference?.resolved?.defs.some((definition) => {
        const definitionNode = definition.node as unknown as EsTreeNode;
        if (!isNodeOfType(definitionNode, "VariableDeclarator")) return false;
        if (!isNodeOfType(definitionNode.init, "CallExpression")) return false;
        const hookCallee = definitionNode.init.callee;
        return (
          isNodeOfType(hookCallee, "Identifier") &&
          hookCallee.name !== "useReducer" &&
          /^use[A-Z0-9]/.test(hookCallee.name)
        );
      });
      if (isCustomHookResult) {
        return;
      }
    } else if (
      !isNodeOfType(child.callee, "MemberExpression") ||
      !isNodeOfType(child.callee.property, "Identifier") ||
      child.callee.property.name !== "setAttribute"
    ) {
      return;
    }
    hasTransferableWork = true;
    return false;
  });
  return hasTransferableWork;
};

const guardHasOtherReactiveSource = (
  analysis: ProgramAnalysis,
  testExpression: EsTreeNode,
  handlerStateDeclarator: EsTreeNode,
): boolean =>
  getDownstreamRefs(analysis, testExpression).some((directReference) =>
    getUpstreamRefs(analysis, directReference).some((reference) => {
      if (isProp(analysis, reference)) return true;
      if (!isState(analysis, reference)) return false;
      return getUseStateDecl(analysis, reference) !== handlerStateDeclarator;
    }),
  );

const consequentHasAdditionalReactiveGuard = (
  analysis: ProgramAnalysis,
  consequent: EsTreeNode,
  handlerStateDeclarator: EsTreeNode,
): boolean => {
  let hasAdditionalGuard = false;
  walkAst(consequent, (child: EsTreeNode): boolean | void => {
    if (hasAdditionalGuard) return false;
    if (child !== consequent && isFunctionLike(child)) return false;
    if (!isNodeOfType(child, "IfStatement")) return;
    if (guardHasOtherReactiveSource(analysis, child.test as EsTreeNode, handlerStateDeclarator)) {
      hasAdditionalGuard = true;
      return false;
    }
  });
  return hasAdditionalGuard;
};

export const noEventHandler = defineRule({
  id: "no-event-handler",
  title: "Event logic handled in an effect",
  tags: ["test-noise"],
  severity: "warn",
  recommendation:
    "Run the side effect in the event handler that triggers it, instead of watching its state from a useEffect. See https://react.dev/learn/you-might-not-need-an-effect#sharing-logic-between-event-handlers",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isReactHookCall(node, "useEffect", context.scopes)) return;
      const analysis = getProgramAnalysis(node);
      if (!analysis || hasCleanup(analysis, node)) return;
      const frames = collectBoundedEffectExecutionFrames(analysis, node);
      for (const frame of frames) {
        let reported = false;
        walkAst(frame.functionNode, (child: EsTreeNode): boolean | void => {
          if (reported) return false;
          if (child !== frame.functionNode && isFunctionLike(child)) return false;
          if (!isNodeOfType(child, "IfStatement") || child.alternate) return;
          if (
            !consequentHasTransferableWork(analysis, child.consequent as EsTreeNode, context.scopes)
          ) {
            return;
          }
          const stateReferences = collectGuardStateReferences(analysis, child.test as EsTreeNode);
          const handlerStateDeclarators = new Set(
            stateReferences
              .filter((reference) => isStateWrittenOnlyFromEventHandlers(analysis, reference))
              .map((reference) => getUseStateDecl(analysis, reference))
              .filter((declarator): declarator is EsTreeNode => Boolean(declarator)),
          );
          if (handlerStateDeclarators.size !== 1) return;
          const handlerStateDeclarator = [...handlerStateDeclarators][0];
          if (!handlerStateDeclarator) return;
          if (
            guardHasOtherReactiveSource(
              analysis,
              child.test as EsTreeNode,
              handlerStateDeclarator,
            ) ||
            consequentHasAdditionalReactiveGuard(
              analysis,
              child.consequent as EsTreeNode,
              handlerStateDeclarator,
            )
          ) {
            return;
          }
          context.report({
            node,
            message:
              "Faking an event handler with state plus a useEffect costs an extra render & runs late.",
          });
          reported = true;
          return false;
        });
        if (reported) return;
      }
    },
  }),
});
