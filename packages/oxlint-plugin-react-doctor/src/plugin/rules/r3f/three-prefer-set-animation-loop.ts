import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isGlobalAnimationFrameCallee } from "../../utils/is-global-animation-frame-callee.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { resolveThreeAnimationLoopCallback } from "./utils/resolve-three-animation-loop-callback.js";
import { getThreeConstructorName } from "./utils/get-three-constructor-name.js";

const WEB_XR_BUTTON_EXPORT_NAMES = new Set(["ARButton", "VRButton", "XRButton"]);

const isThreeRendererXrMember = (node: EsTreeNode, context: RuleContext): boolean => {
  if (!isNodeOfType(node, "MemberExpression") || getStaticPropertyName(node) !== "xr") return false;
  const constructorName = getThreeConstructorName(node.object, context.scopes);
  return constructorName === "WebGLRenderer" || constructorName === "WebGPURenderer";
};

export const threePreferSetAnimationLoop = defineRule({
  id: "three-prefer-set-animation-loop",
  title: "Three.js renderer uses manual animation frames",
  category: "Correctness",
  severity: "warn",
  recommendation:
    "Use renderer.setAnimationLoop for Three.js animation-loop compatibility, including WebXR",
  create: (context: RuleContext) => {
    const reportedCallbacks = new Set<EsTreeNode>();
    const manualAnimationFrames: EsTreeNodeOfType<"CallExpression">[] = [];
    let usesWebXr = false;
    return {
      ImportDeclaration(node: EsTreeNodeOfType<"ImportDeclaration">) {
        if (!/\b(?:webxr|xr)\b/i.test(String(node.source.value))) return;
        if (
          node.specifiers.some(
            (specifier) =>
              isNodeOfType(specifier, "ImportSpecifier") &&
              isNodeOfType(specifier.imported, "Identifier") &&
              WEB_XR_BUTTON_EXPORT_NAMES.has(specifier.imported.name),
          )
        ) {
          usesWebXr = true;
        }
      },
      MemberExpression(node: EsTreeNodeOfType<"MemberExpression">) {
        if (isThreeRendererXrMember(node, context)) usesWebXr = true;
        if (
          getStaticPropertyName(node) === "xr" &&
          isNodeOfType(node.object, "Identifier") &&
          node.object.name === "navigator" &&
          context.scopes.isGlobalReference(node.object)
        ) {
          usesWebXr = true;
        }
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (!isGlobalAnimationFrameCallee(node.callee, context.scopes)) return;
        const callback = resolveThreeAnimationLoopCallback(node, context.scopes);
        if (!callback || reportedCallbacks.has(callback)) return;
        reportedCallbacks.add(callback);
        manualAnimationFrames.push(node);
      },
      "Program:exit"() {
        if (!usesWebXr) return;
        for (const node of manualAnimationFrames) {
          context.report({
            node,
            message:
              "This WebXR-capable Three.js render loop is driven by requestAnimationFrame. Use renderer.setAnimationLoop(callback) so immersive sessions receive frames",
          });
        }
      },
    };
  },
});
