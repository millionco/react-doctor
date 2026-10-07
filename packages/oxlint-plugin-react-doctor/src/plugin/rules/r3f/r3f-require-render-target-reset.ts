import { defineRule } from "../../utils/define-rule.js";
import { doNodesCoverEveryPathAfterNode } from "../../utils/do-nodes-cover-every-path-after-node.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isImportedOrStableParameterCall } from "../../utils/is-imported-or-stable-parameter-call.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveExpressionKey } from "../../utils/resolve-expression-key.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import { getThreeConstructorName } from "./utils/get-three-constructor-name.js";
import { isR3fFrameRendererExpression } from "./utils/is-r3f-frame-renderer-expression.js";
import { resolveR3fCallback } from "./utils/resolve-r3f-callback.js";

interface FrameRenderTargetBinding {
  readonly node: EsTreeNodeOfType<"CallExpression">;
  readonly rendererKey: string;
}

interface FrameRenderTargetReset {
  readonly node: EsTreeNodeOfType<"CallExpression">;
  readonly rendererKey: string;
}

const RENDER_TARGET_CONSTRUCTOR_NAMES: ReadonlySet<string> = new Set([
  "RenderTarget",
  "WebGLCubeRenderTarget",
  "WebGLRenderTarget",
]);

const analyzeFrameCallback = (
  callback: EsTreeNode,
  context: RuleContext,
): ReadonlyArray<FrameRenderTargetBinding> => {
  const bindings: FrameRenderTargetBinding[] = [];
  const resets: FrameRenderTargetReset[] = [];
  walkAst(callback, (candidate) => {
    if (candidate !== callback && isFunctionLike(candidate)) return false;
    if (!isNodeOfType(candidate, "CallExpression")) return;
    const callee = stripParenExpression(candidate.callee);
    if (
      isNodeOfType(callee, "MemberExpression") &&
      getStaticPropertyName(callee) === "setRenderTarget" &&
      isR3fFrameRendererExpression(callee.object, callback, context.scopes)
    ) {
      const rendererKey = resolveExpressionKey(callee.object, context);
      const target = candidate.arguments[0];
      if (!rendererKey || !target || isNodeOfType(target, "SpreadElement")) return;
      const targetCandidate = stripParenExpression(target);
      if (isNodeOfType(targetCandidate, "Literal") && targetCandidate.value === null) {
        resets.push({ node: candidate, rendererKey });
        return;
      }
      if (
        RENDER_TARGET_CONSTRUCTOR_NAMES.has(
          getThreeConstructorName(targetCandidate, context.scopes) ?? "",
        )
      ) {
        bindings.push({ node: candidate, rendererKey });
      }
      return;
    }
    if (!isImportedOrStableParameterCall(candidate, context.scopes)) return;
    for (const argument of candidate.arguments) {
      if (
        isNodeOfType(argument, "SpreadElement") ||
        !isR3fFrameRendererExpression(argument, callback, context.scopes)
      ) {
        continue;
      }
      const rendererKey = resolveExpressionKey(argument, context);
      if (rendererKey) resets.push({ node: candidate, rendererKey });
    }
  });
  return bindings.filter(
    (binding) =>
      !doNodesCoverEveryPathAfterNode(
        binding.node,
        resets
          .filter((reset) => reset.rendererKey === binding.rendererKey)
          .map((reset) => reset.node),
        context,
      ),
  );
};

export const r3fRequireRenderTargetReset = defineRule({
  id: "r3f-require-render-target-reset",
  title: "R3F renderer leaves an offscreen target bound",
  category: "Correctness",
  severity: "error",
  recommendation:
    "Call gl.setRenderTarget(null) on every useFrame path after rendering to an offscreen target",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      const callback = resolveR3fCallback(node, "useFrame", context.scopes);
      if (!callback) return;
      for (const binding of analyzeFrameCallback(callback, context)) {
        context.report({
          node: binding.node,
          message:
            "This useFrame callback binds an offscreen render target without restoring the default framebuffer on every path, so R3F or later subscribers can render to the wrong target",
        });
      }
    },
  }),
});
