import { defineRule } from "../../utils/define-rule.js";
import { doNodesCoverEveryPathAfterNode } from "../../utils/do-nodes-cover-every-path-after-node.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getRangeStart } from "../../utils/get-range-start.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isNodeConditionallyExecuted } from "../../utils/is-node-conditionally-executed.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveExpressionKey } from "../../utils/resolve-expression-key.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { getThreeConstructorName } from "./utils/get-three-constructor-name.js";

interface TextureWrappingMutation {
  readonly node: EsTreeNodeOfType<"AssignmentExpression">;
  readonly textureKey: string;
}

interface TextureUpload {
  readonly node: EsTreeNodeOfType<"AssignmentExpression">;
  readonly textureKey: string;
}

const THREE_RENDERER_NAMES: ReadonlySet<string> = new Set(["WebGLRenderer", "WebGPURenderer"]);

const THREE_TEXTURE_NAMES: ReadonlySet<string> = new Set([
  "CanvasTexture",
  "CompressedTexture",
  "Data3DTexture",
  "DataArrayTexture",
  "DataTexture",
  "DepthTexture",
  "FramebufferTexture",
  "Texture",
  "VideoTexture",
]);

const getTextureWrappingMutation = (
  node: EsTreeNodeOfType<"AssignmentExpression">,
  context: RuleContext,
): TextureWrappingMutation | null => {
  const target = stripParenExpression(node.left);
  if (
    node.operator !== "=" ||
    !isNodeOfType(target, "MemberExpression") ||
    (getStaticPropertyName(target) !== "wrapS" && getStaticPropertyName(target) !== "wrapT") ||
    !THREE_TEXTURE_NAMES.has(getThreeConstructorName(target.object, context.scopes) ?? "")
  ) {
    return null;
  }
  const textureKey = resolveExpressionKey(target.object, context);
  return textureKey ? { node, textureKey } : null;
};

const getTextureUpload = (
  node: EsTreeNodeOfType<"AssignmentExpression">,
  context: RuleContext,
): TextureUpload | null => {
  const target = stripParenExpression(node.left);
  const value = stripParenExpression(node.right);
  if (
    node.operator !== "=" ||
    !isNodeOfType(value, "Literal") ||
    value.value !== true ||
    !isNodeOfType(target, "MemberExpression") ||
    getStaticPropertyName(target) !== "needsUpdate" ||
    !THREE_TEXTURE_NAMES.has(getThreeConstructorName(target.object, context.scopes) ?? "")
  ) {
    return null;
  }
  const textureKey = resolveExpressionKey(target.object, context);
  return textureKey ? { node, textureKey } : null;
};

const isRendererRenderCall = (
  node: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): boolean => {
  const callee = stripParenExpression(node.callee);
  return Boolean(
    isNodeOfType(callee, "MemberExpression") &&
    getStaticPropertyName(callee) === "render" &&
    THREE_RENDERER_NAMES.has(getThreeConstructorName(callee.object, context.scopes) ?? ""),
  );
};

const uploadCoversMutation = (
  mutation: TextureWrappingMutation,
  uploads: ReadonlyArray<TextureUpload>,
  program: EsTreeNode,
  context: RuleContext,
): boolean => {
  const owner = context.cfg.enclosingFunction(mutation.node);
  const matchingUploads = uploads.filter(
    (upload) =>
      upload.textureKey === mutation.textureKey &&
      context.cfg.enclosingFunction(upload.node) === owner,
  );
  if (owner) {
    return doNodesCoverEveryPathAfterNode(
      mutation.node,
      matchingUploads.map((upload) => upload.node),
      context,
    );
  }
  const mutationStart = getRangeStart(mutation.node);
  return matchingUploads.some((upload) => {
    const uploadStart = getRangeStart(upload.node);
    return Boolean(
      mutationStart !== null &&
      uploadStart !== null &&
      uploadStart > mutationStart &&
      !isNodeConditionallyExecuted(upload.node, program),
    );
  });
};

export const threeRequireTextureUpdateAfterWrappingChange = defineRule({
  id: "three-require-texture-update-after-wrapping-change",
  title: "Three.js texture wrapping changes without re-upload",
  category: "Correctness",
  severity: "error",
  recommendation:
    "Set texture.needsUpdate to true after changing wrapS or wrapT on a texture that has already rendered",
  create: (context: RuleContext) => {
    const mutations: TextureWrappingMutation[] = [];
    const renderCalls: EsTreeNodeOfType<"CallExpression">[] = [];
    const uploads: TextureUpload[] = [];
    let program: EsTreeNode | null = null;
    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        program = node;
      },
      AssignmentExpression(node: EsTreeNodeOfType<"AssignmentExpression">) {
        const mutation = getTextureWrappingMutation(node, context);
        if (mutation) mutations.push(mutation);
        const upload = getTextureUpload(node, context);
        if (upload) uploads.push(upload);
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (isRendererRenderCall(node, context)) renderCalls.push(node);
      },
      "Program:exit"() {
        if (!program) return;
        for (const mutation of mutations) {
          const mutationStart = getRangeStart(mutation.node);
          const owner = context.cfg.enclosingFunction(mutation.node);
          const hasPriorRender = renderCalls.some((renderCall) => {
            const renderStart = getRangeStart(renderCall);
            return (
              context.cfg.enclosingFunction(renderCall) === owner &&
              mutationStart !== null &&
              renderStart !== null &&
              renderStart < mutationStart
            );
          });
          if (!hasPriorRender || uploadCoversMutation(mutation, uploads, program, context))
            continue;
          context.report({
            node: mutation.node,
            message:
              "This texture wrapping changes after the texture has rendered without setting texture.needsUpdate to true on every path, so the GPU sampler can remain stale",
          });
        }
      },
    };
  },
});
