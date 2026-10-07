import { defineRule } from "../../utils/define-rule.js";
import { doNodesCoverEveryPathAfterNode } from "../../utils/do-nodes-cover-every-path-after-node.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getRangeStart } from "../../utils/get-range-start.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isImportedOrStableParameterCall } from "../../utils/is-imported-or-stable-parameter-call.js";
import { isNodeConditionallyExecuted } from "../../utils/is-node-conditionally-executed.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveExpressionKey } from "../../utils/resolve-expression-key.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { getThreeConstructorName } from "./utils/get-three-constructor-name.js";

interface RenderTargetBinding {
  readonly node: EsTreeNodeOfType<"CallExpression">;
  readonly rendererKey: string;
}

interface RenderTargetReset {
  readonly node: EsTreeNodeOfType<"CallExpression">;
  readonly rendererKey: string;
}

const RENDER_TARGET_CONSTRUCTOR_NAMES: ReadonlySet<string> = new Set([
  "RenderTarget",
  "WebGLCubeRenderTarget",
  "WebGLRenderTarget",
]);

const RENDERER_CONSTRUCTOR_NAMES: ReadonlySet<string> = new Set([
  "WebGLRenderer",
  "WebGPURenderer",
]);

const getRenderTargetOperation = (
  node: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): RenderTargetBinding | RenderTargetReset | null => {
  const callee = stripParenExpression(node.callee);
  if (
    !isNodeOfType(callee, "MemberExpression") ||
    getStaticPropertyName(callee) !== "setRenderTarget" ||
    !RENDERER_CONSTRUCTOR_NAMES.has(getThreeConstructorName(callee.object, context.scopes) ?? "")
  ) {
    return null;
  }
  const rendererKey = resolveExpressionKey(callee.object, context);
  const target = node.arguments[0];
  if (!rendererKey || !target || isNodeOfType(target, "SpreadElement")) return null;
  const candidate = stripParenExpression(target);
  if (isNodeOfType(candidate, "Literal") && candidate.value === null) {
    return { node, rendererKey };
  }
  return RENDER_TARGET_CONSTRUCTOR_NAMES.has(
    getThreeConstructorName(candidate, context.scopes) ?? "",
  )
    ? { node, rendererKey }
    : null;
};

const getOpaqueRenderTargetResets = (
  node: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): ReadonlyArray<RenderTargetReset> => {
  if (!isImportedOrStableParameterCall(node, context.scopes)) return [];
  const resets: RenderTargetReset[] = [];
  for (const argument of node.arguments) {
    if (
      isNodeOfType(argument, "SpreadElement") ||
      !RENDERER_CONSTRUCTOR_NAMES.has(getThreeConstructorName(argument, context.scopes) ?? "")
    ) {
      continue;
    }
    const rendererKey = resolveExpressionKey(argument, context);
    if (rendererKey) resets.push({ node, rendererKey });
  }
  return resets;
};

const resetCoversBinding = (
  binding: RenderTargetBinding,
  resets: ReadonlyArray<RenderTargetReset>,
  program: EsTreeNode,
  context: RuleContext,
): boolean => {
  const owner = context.cfg.enclosingFunction(binding.node);
  const matchingResets = resets.filter(
    (reset) =>
      reset.rendererKey === binding.rendererKey &&
      context.cfg.enclosingFunction(reset.node) === owner,
  );
  if (owner) {
    return doNodesCoverEveryPathAfterNode(
      binding.node,
      matchingResets.map((reset) => reset.node),
      context,
    );
  }
  const bindingStart = getRangeStart(binding.node);
  return matchingResets.some((reset) => {
    const resetStart = getRangeStart(reset.node);
    return Boolean(
      bindingStart !== null &&
      resetStart !== null &&
      resetStart > bindingStart &&
      !isNodeConditionallyExecuted(reset.node, program),
    );
  });
};

export const threeRequireRenderTargetReset = defineRule({
  id: "three-require-render-target-reset",
  title: "Three.js renderer leaves an offscreen target bound",
  category: "Correctness",
  severity: "error",
  recommendation:
    "Call renderer.setRenderTarget(null) on every path after rendering to an offscreen target",
  create: (context: RuleContext) => {
    const bindings: RenderTargetBinding[] = [];
    const resets: RenderTargetReset[] = [];
    let program: EsTreeNode | null = null;
    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        program = node;
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        const operation = getRenderTargetOperation(node, context);
        if (operation) {
          const target = node.arguments[0];
          const candidate =
            target && !isNodeOfType(target, "SpreadElement") ? stripParenExpression(target) : null;
          if (candidate && isNodeOfType(candidate, "Literal") && candidate.value === null) {
            resets.push(operation);
          } else {
            bindings.push(operation);
          }
          return;
        }
        resets.push(...getOpaqueRenderTargetResets(node, context));
      },
      "Program:exit"() {
        if (!program) return;
        for (const binding of bindings) {
          if (resetCoversBinding(binding, resets, program, context)) continue;
          context.report({
            node: binding.node,
            message:
              "This renderer binds an offscreen render target without restoring the default framebuffer on every path, so later rendering can go to the wrong target",
          });
        }
      },
    };
  },
});
