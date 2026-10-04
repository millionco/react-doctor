import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isImportedOrStableParameterCall } from "../../utils/is-imported-or-stable-parameter-call.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveExpressionKey } from "../../utils/resolve-expression-key.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { getThreeConstructorName } from "./utils/get-three-constructor-name.js";
import { resolveGlobalResizeHandler } from "./utils/resolve-global-resize-handler.js";
import { walkFunctionExecution } from "./utils/walk-function-execution.js";

interface ThreeRenderCameraFact {
  cameraKey: string;
  rendererKey: string;
}

interface ThreeResizeFact {
  aspectCameraKeys: ReadonlySet<string>;
  opaqueCameraKeys: ReadonlySet<string>;
  rendererKey: string;
  setSizeNode: EsTreeNode;
}

const collectResizeFacts = (
  callback: EsTreeNode,
  context: RuleContext,
): ReadonlyArray<ThreeResizeFact> => {
  const aspectCameraKeys = new Set<string>();
  const opaqueCameraKeys = new Set<string>();
  const rendererSetSizes = new Map<string, EsTreeNode>();
  walkFunctionExecution(callback, context.scopes, (candidate) => {
    if (isNodeOfType(candidate, "AssignmentExpression")) {
      const target = stripParenExpression(candidate.left);
      if (
        isNodeOfType(target, "MemberExpression") &&
        getStaticPropertyName(target) === "aspect" &&
        getThreeConstructorName(target.object, context.scopes) === "PerspectiveCamera"
      ) {
        const cameraKey = resolveExpressionKey(target.object, context);
        if (cameraKey) aspectCameraKeys.add(cameraKey);
      }
      return;
    }
    if (!isNodeOfType(candidate, "CallExpression")) return;
    if (
      isNodeOfType(candidate.callee, "MemberExpression") &&
      getStaticPropertyName(candidate.callee) === "setSize" &&
      getThreeConstructorName(candidate.callee.object, context.scopes) === "WebGLRenderer"
    ) {
      const rendererKey = resolveExpressionKey(candidate.callee.object, context);
      if (rendererKey) rendererSetSizes.set(rendererKey, candidate);
      return;
    }
    if (!isImportedOrStableParameterCall(candidate, context.scopes)) return;
    for (const argument of candidate.arguments) {
      if (
        isNodeOfType(argument, "SpreadElement") ||
        getThreeConstructorName(argument, context.scopes) !== "PerspectiveCamera"
      ) {
        continue;
      }
      const cameraKey = resolveExpressionKey(argument, context);
      if (cameraKey) opaqueCameraKeys.add(cameraKey);
    }
  });
  return [...rendererSetSizes].map(([rendererKey, setSizeNode]) => ({
    aspectCameraKeys,
    opaqueCameraKeys,
    rendererKey,
    setSizeNode,
  }));
};

export const threeRequireCameraAspectOnResize = defineRule({
  id: "three-require-camera-aspect-on-resize",
  title: "Three.js resize leaves camera aspect stale",
  category: "Correctness",
  severity: "error",
  recommendation:
    "Update each rendered PerspectiveCamera aspect when resizing its renderer, then update its projection matrix",
  create: (context: RuleContext) => {
    const analyzedCallbacks = new Set<EsTreeNode>();
    const renderFacts: ThreeRenderCameraFact[] = [];
    const resizeFacts: ThreeResizeFact[] = [];
    const analyzeResizeSource = (
      node: EsTreeNodeOfType<"AssignmentExpression" | "CallExpression" | "NewExpression">,
    ): void => {
      const callback = resolveGlobalResizeHandler(node, context);
      if (!callback || analyzedCallbacks.has(callback)) return;
      analyzedCallbacks.add(callback);
      resizeFacts.push(...collectResizeFacts(callback, context));
    };
    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        analyzeResizeSource(node);
        if (
          !isNodeOfType(node.callee, "MemberExpression") ||
          getStaticPropertyName(node.callee) !== "render" ||
          getThreeConstructorName(node.callee.object, context.scopes) !== "WebGLRenderer"
        ) {
          return;
        }
        const camera = node.arguments[1];
        if (
          !camera ||
          isNodeOfType(camera, "SpreadElement") ||
          getThreeConstructorName(camera, context.scopes) !== "PerspectiveCamera"
        ) {
          return;
        }
        const rendererKey = resolveExpressionKey(node.callee.object, context);
        const cameraKey = resolveExpressionKey(camera, context);
        if (rendererKey && cameraKey) renderFacts.push({ cameraKey, rendererKey });
      },
      AssignmentExpression(node: EsTreeNodeOfType<"AssignmentExpression">) {
        analyzeResizeSource(node);
      },
      NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
        analyzeResizeSource(node);
      },
      "Program:exit"() {
        for (const resizeFact of resizeFacts) {
          const missingCamera = renderFacts.find(
            (renderFact) =>
              renderFact.rendererKey === resizeFact.rendererKey &&
              !resizeFact.aspectCameraKeys.has(renderFact.cameraKey) &&
              !resizeFact.opaqueCameraKeys.has(renderFact.cameraKey),
          );
          if (!missingCamera) continue;
          context.report({
            node: resizeFact.setSizeNode,
            message:
              "This resize handler changes the renderer size without updating the aspect of a PerspectiveCamera rendered by it, so the scene can stretch or squash",
          });
        }
      },
    };
  },
});
