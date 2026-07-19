import { defineRule } from "../../utils/define-rule.js";
import { createRemotionRenderEvidenceChecker } from "../../utils/create-remotion-render-evidence-checker.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findRenderPhaseComponentOrHook } from "../../utils/find-render-phase-component-or-hook.js";
import { getImportBindingForName } from "../../utils/find-import-source-for-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";

export const remotionNoNextImage = defineRule({
  id: "remotion-no-next-image",
  title: "Next.js Image can flicker in Remotion",
  tags: ["react-jsx-only"],
  requires: ["remotion:4"],
  severity: "error",
  recommendation: "Use `Img` from `remotion`, which delays rendering until the image is loaded.",
  create: (context) => {
    const renderEvidence = createRemotionRenderEvidenceChecker(context);
    return {
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (!isNodeOfType(node.name, "JSXIdentifier")) return;
        const renderFunction = findRenderPhaseComponentOrHook(node, context.scopes);
        if (!renderFunction || !renderEvidence.functionHasEvidence(renderFunction)) return;
        const symbol = context.scopes.symbolFor(node.name);
        if (symbol?.kind !== "import") return;
        const importBinding = getImportBindingForName(node.name, symbol.name);
        if (importBinding?.source !== "next/image" || importBinding.exportedName !== "default") {
          return;
        }
        context.report({
          node,
          message:
            "Next.js <Image> does not expose a reliable loading signal to Remotion, so rendered frames can flicker. Use <Img> from `remotion` instead.",
        });
      },
    };
  },
});
