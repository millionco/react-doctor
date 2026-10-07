import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isImportedOrStableParameterCall } from "../../utils/is-imported-or-stable-parameter-call.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveExpressionKey } from "../../utils/resolve-expression-key.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getThreeConstructorName } from "./utils/get-three-constructor-name.js";
import { resolveGlobalResizeHandler } from "./utils/resolve-global-resize-handler.js";
import { walkFunctionExecution } from "./utils/walk-function-execution.js";

interface EffectComposerBinding {
  readonly composerKey: string;
  readonly rendererKey: string;
}

interface EffectComposerResizeFact {
  readonly delegatedComposerKeys: ReadonlySet<string>;
  readonly resizedComposerKeys: ReadonlySet<string>;
  readonly rendererKey: string;
  readonly rendererResizeNode: EsTreeNode;
}

const getComposerBinding = (
  node: EsTreeNodeOfType<"VariableDeclarator">,
  context: RuleContext,
): EffectComposerBinding | null => {
  if (
    !node.init ||
    !isNodeOfType(node.id, "Identifier") ||
    getThreeConstructorName(node.init, context.scopes) !== "EffectComposer"
  ) {
    return null;
  }
  const initializer = node.init;
  if (!isNodeOfType(initializer, "NewExpression")) return null;
  const renderer = initializer.arguments[0];
  if (!renderer || isNodeOfType(renderer, "SpreadElement")) return null;
  const composerKey = resolveExpressionKey(node.id, context);
  const rendererKey = resolveExpressionKey(renderer, context);
  return composerKey && rendererKey ? { composerKey, rendererKey } : null;
};

const collectResizeFacts = (
  callback: EsTreeNode,
  context: RuleContext,
): ReadonlyArray<EffectComposerResizeFact> => {
  const delegatedComposerKeys = new Set<string>();
  const resizedComposerKeys = new Set<string>();
  const rendererResizes = new Map<string, EsTreeNode>();
  walkFunctionExecution(callback, context.scopes, (candidate) => {
    if (!isNodeOfType(candidate, "CallExpression")) return;
    if (isNodeOfType(candidate.callee, "MemberExpression")) {
      const methodName = getStaticPropertyName(candidate.callee);
      const targetKey = resolveExpressionKey(candidate.callee.object, context);
      const constructorName = getThreeConstructorName(candidate.callee.object, context.scopes);
      if (
        methodName === "setSize" &&
        targetKey &&
        (constructorName === "WebGLRenderer" || constructorName === "WebGPURenderer")
      ) {
        rendererResizes.set(targetKey, candidate);
        return;
      }
      if (methodName === "setSize" && targetKey) {
        resizedComposerKeys.add(targetKey);
        return;
      }
    }
    if (!isImportedOrStableParameterCall(candidate, context.scopes)) return;
    for (const argument of candidate.arguments) {
      if (
        isNodeOfType(argument, "SpreadElement") ||
        getThreeConstructorName(argument, context.scopes) !== "EffectComposer"
      ) {
        continue;
      }
      const composerKey = resolveExpressionKey(argument, context);
      if (composerKey) delegatedComposerKeys.add(composerKey);
    }
  });
  return [...rendererResizes].map(([rendererKey, rendererResizeNode]) => ({
    delegatedComposerKeys,
    rendererKey,
    rendererResizeNode,
    resizedComposerKeys,
  }));
};

export const threeEffectComposerRequireSizeOnResize = defineRule({
  id: "three-effect-composer-require-size-on-resize",
  title: "EffectComposer size is stale after renderer resize",
  category: "Correctness",
  severity: "error",
  recommendation: "Resize every EffectComposer associated with a resized renderer",
  create: (context: RuleContext) => {
    const analyzedCallbacks = new Set<EsTreeNode>();
    const assignmentAliases: Array<readonly [string, string]> = [];
    const composerBindings: EffectComposerBinding[] = [];
    const resizeFacts: EffectComposerResizeFact[] = [];
    const analyzeResizeSource = (
      node: EsTreeNodeOfType<"AssignmentExpression" | "CallExpression" | "NewExpression">,
    ): void => {
      const callback = resolveGlobalResizeHandler(node, context);
      if (!callback || analyzedCallbacks.has(callback)) return;
      analyzedCallbacks.add(callback);
      resizeFacts.push(...collectResizeFacts(callback, context));
    };
    return {
      AssignmentExpression(node: EsTreeNodeOfType<"AssignmentExpression">) {
        if (node.operator === "=") {
          const targetKey = resolveExpressionKey(node.left, context);
          const sourceKey = resolveExpressionKey(node.right, context);
          if (targetKey && sourceKey) assignmentAliases.push([targetKey, sourceKey]);
        }
        analyzeResizeSource(node);
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        analyzeResizeSource(node);
      },
      NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
        analyzeResizeSource(node);
      },
      VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
        const binding = getComposerBinding(node, context);
        if (binding) composerBindings.push(binding);
      },
      "Program:exit"() {
        const areKeysAliased = (leftKey: string, rightKey: string): boolean => {
          const pendingKeys = [leftKey];
          const visitedKeys = new Set<string>();
          while (pendingKeys.length > 0) {
            const currentKey = pendingKeys.pop();
            if (!currentKey || visitedKeys.has(currentKey)) continue;
            if (currentKey === rightKey) return true;
            visitedKeys.add(currentKey);
            for (const [aliasTarget, aliasSource] of assignmentAliases) {
              if (aliasTarget === currentKey) pendingKeys.push(aliasSource);
              if (aliasSource === currentKey) pendingKeys.push(aliasTarget);
            }
          }
          return false;
        };
        for (const resizeFact of resizeFacts) {
          const staleComposer = composerBindings.find(
            (binding) =>
              binding.rendererKey === resizeFact.rendererKey &&
              ![...resizeFact.resizedComposerKeys].some((resizedKey) =>
                areKeysAliased(binding.composerKey, resizedKey),
              ) &&
              !resizeFact.delegatedComposerKeys.has(binding.composerKey),
          );
          if (!staleComposer) continue;
          context.report({
            node: resizeFact.rendererResizeNode,
            message:
              "This handler resizes a renderer without resizing its EffectComposer, so postprocessing targets keep stale dimensions",
          });
        }
      },
    };
  },
});
