import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findRenderPhaseComponentOrHook } from "../../utils/find-render-phase-component-or-hook.js";
import { getEffectCallback } from "../../utils/get-effect-callback.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isGlobalBrowserFunctionCall } from "../../utils/is-global-browser-function-call.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveConstIdentifierAlias } from "../../utils/resolve-const-identifier-alias.js";
import { resolveExactLocalFunction } from "../../utils/resolve-exact-local-function.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import { getApiReferenceProvenance } from "./utils/get-api-reference-provenance.js";
import { isR3fApiCall } from "./utils/is-r3f-api-call.js";
import { isR3fReactApiCall } from "./utils/is-r3f-react-api-call.js";
import { isR3fUseThreeStateProperty } from "./utils/is-r3f-use-three-state-property.js";
import { resolveLocalReactCallback } from "./utils/resolve-local-react-callback.js";
import { walkFunctionExecution } from "./utils/walk-function-execution.js";

const EFFECT_HOOK_NAMES = new Set(["useEffect", "useInsertionEffect", "useLayoutEffect"]);

const getAnimationFrameCallback = (
  call: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
): EsTreeNode | null => {
  const callbackArgument = call.arguments[0];
  if (!callbackArgument || isNodeOfType(callbackArgument, "SpreadElement")) return null;
  return resolveExactLocalFunction(callbackArgument, scopes);
};

const callbackDirectlySchedulesItself = (callback: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  let doesScheduleItself = false;
  walkAst(callback, (candidate) => {
    if (doesScheduleItself || (candidate !== callback && isFunctionLike(candidate))) return false;
    if (
      !isNodeOfType(candidate, "CallExpression") ||
      !isGlobalBrowserFunctionCall(candidate, "requestAnimationFrame", scopes)
    ) {
      return;
    }
    doesScheduleItself = getAnimationFrameCallback(candidate, scopes) === callback;
  });
  return doesScheduleItself;
};

const collectRecursiveAnimationFrameStarts = (
  executedFunction: EsTreeNode,
  scopes: ScopeAnalysis,
): Set<EsTreeNodeOfType<"CallExpression">> => {
  const starts = new Set<EsTreeNodeOfType<"CallExpression">>();
  walkFunctionExecution(executedFunction, scopes, (candidate) => {
    if (
      !isNodeOfType(candidate, "CallExpression") ||
      !isGlobalBrowserFunctionCall(candidate, "requestAnimationFrame", scopes)
    ) {
      return;
    }
    const callback = getAnimationFrameCallback(candidate, scopes);
    if (callback && callbackDirectlySchedulesItself(callback, scopes)) starts.add(candidate);
  });
  return starts;
};

const collectR3fRendererAnimationLoopStarts = (
  executedFunction: EsTreeNode,
  context: RuleContext,
): Set<EsTreeNodeOfType<"CallExpression">> => {
  const starts = new Set<EsTreeNodeOfType<"CallExpression">>();
  walkFunctionExecution(executedFunction, context.scopes, (candidate) => {
    if (
      !isNodeOfType(candidate, "CallExpression") ||
      !isNodeOfType(candidate.callee, "MemberExpression") ||
      getStaticPropertyName(candidate.callee) !== "setAnimationLoop" ||
      (!isR3fUseThreeStateProperty(candidate.callee.object, "gl", context) &&
        !isR3fUseThreeStateProperty(candidate.callee.object, "renderer", context))
    ) {
      return;
    }
    const callbackArgument = candidate.arguments[0];
    if (!callbackArgument || isNodeOfType(callbackArgument, "SpreadElement")) return;
    const callbackExpression = stripParenExpression(callbackArgument);
    const localCallback = resolveLocalReactCallback(callbackExpression, context.scopes);
    const importedCallbackSymbol = isNodeOfType(callbackExpression, "Identifier")
      ? resolveConstIdentifierAlias(callbackExpression, context.scopes)
      : null;
    const importedCallback = getApiReferenceProvenance(callbackExpression, context.scopes);
    if (localCallback || importedCallbackSymbol?.kind === "import" || importedCallback) {
      starts.add(candidate);
    }
  });
  return starts;
};

export const r3fNoRecursiveRafWithUseFrame = defineRule({
  id: "r3f-no-recursive-raf-with-use-frame",
  title: "Competing animation loop alongside useFrame",
  category: "Performance",
  severity: "warn",
  recommendation:
    "Use R3F's useFrame subscription as the component's single animation loop instead of starting a second browser or renderer loop",
  create: (context: RuleContext) => {
    const hasUseFrameByOwner = new Map<EsTreeNode, boolean>();
    const analyzedRenderOwners = new Set<EsTreeNode>();
    const reportedStarts = new Set<EsTreeNode>();
    const ownerUsesFrameSubscription = (owner: EsTreeNode): boolean => {
      const cachedResult = hasUseFrameByOwner.get(owner);
      if (cachedResult !== undefined) return cachedResult;
      let hasUseFrame = false;
      walkFunctionExecution(owner, context.scopes, (candidate) => {
        if (!hasUseFrame && isR3fApiCall(candidate, "useFrame", context.scopes)) {
          hasUseFrame = true;
        }
      });
      hasUseFrameByOwner.set(owner, hasUseFrame);
      return hasUseFrame;
    };
    const reportStarts = (executedFunction: EsTreeNode, owner: EsTreeNode): void => {
      if (!ownerUsesFrameSubscription(owner)) return;
      for (const start of collectRecursiveAnimationFrameStarts(executedFunction, context.scopes)) {
        if (reportedStarts.has(start)) continue;
        reportedStarts.add(start);
        context.report({
          node: start,
          message:
            "This component starts a recursive requestAnimationFrame loop while also subscribing to R3F useFrame. Move the repeated work into useFrame so R3F owns frame scheduling",
        });
      }
      for (const start of collectR3fRendererAnimationLoopStarts(executedFunction, context)) {
        if (reportedStarts.has(start)) continue;
        reportedStarts.add(start);
        context.report({
          node: start,
          message:
            "This component starts setAnimationLoop on R3F's renderer while also subscribing to useFrame. Move the repeated work into useFrame so R3F remains the only frame scheduler",
        });
      }
    };

    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        const owner = findRenderPhaseComponentOrHook(node, context.scopes);
        if (!owner) return;
        if (!analyzedRenderOwners.has(owner)) {
          analyzedRenderOwners.add(owner);
          reportStarts(owner, owner);
        }
        if (!isR3fReactApiCall(node, EFFECT_HOOK_NAMES, context.scopes)) return;
        const effectCallback = getEffectCallback(node, context.scopes);
        if (effectCallback) reportStarts(effectCallback, owner);
      },
    };
  },
});
