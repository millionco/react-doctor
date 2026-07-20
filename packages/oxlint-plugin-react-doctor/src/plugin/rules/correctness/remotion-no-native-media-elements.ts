import { defineRule } from "../../utils/define-rule.js";
import { createRemotionRenderEvidenceChecker } from "../../utils/create-remotion-render-evidence-checker.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findRenderPhaseComponentOrHook } from "../../utils/find-render-phase-component-or-hook.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";

const REMOTION_MEDIA_REPLACEMENT_BY_TAG = new Map([
  ["audio", "`Audio` from `@remotion/media`"],
  ["iframe", "`IFrame` from `remotion`"],
  ["img", "`Img` from `remotion`"],
  ["video", "`Video` from `@remotion/media`"],
]);

export const remotionNoNativeMediaElements = defineRule({
  id: "remotion-no-native-media-elements",
  title: "Native media element bypasses Remotion loading",
  tags: ["react-jsx-only"],
  requires: ["remotion:4"],
  severity: "error",
  recommendation:
    "Use Remotion's media components so rendering waits for assets and seeks media to the requested frame.",
  create: (context) => {
    const renderEvidence = createRemotionRenderEvidenceChecker(context);
    return {
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (!isNodeOfType(node.name, "JSXIdentifier")) return;
        const renderFunction = findRenderPhaseComponentOrHook(node, context.scopes);
        if (!renderFunction || !renderEvidence.functionHasEvidence(renderFunction)) return;
        const replacement = REMOTION_MEDIA_REPLACEMENT_BY_TAG.get(node.name.name);
        if (!replacement) return;
        context.report({
          node,
          message: `Native <${node.name.name}> does not let Remotion reliably wait for and synchronize the asset. Use ${replacement} instead.`,
        });
      },
    };
  },
});
