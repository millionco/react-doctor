import { OG_IMAGE_FILE_PATTERN } from "../../constants/nextjs.js";
import { defineRule } from "../../utils/define-rule.js";
import { normalizeFilename } from "../../utils/normalize-filename.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const nextjsNoEdgeOgRuntime = defineRule<Rule>({
  id: "nextjs-no-edge-og-runtime",
  title: "Edge runtime in OG image route",
  tags: ["test-noise"],
  requires: ["nextjs"],
  severity: "warn",
  recommendation:
    "Remove `export const runtime = 'edge'` from OG image files. The default Node.js runtime supports more fonts and APIs",
  create: (context: RuleContext) => {
    let isOgImageFile = false;

    return {
      Program() {
        const filename = normalizeFilename(context.filename ?? "");
        isOgImageFile = OG_IMAGE_FILE_PATTERN.test(filename);
      },
      ExportNamedDeclaration(node: EsTreeNodeOfType<"ExportNamedDeclaration">) {
        if (!isOgImageFile) return;

        const declaration = node.declaration;
        if (!isNodeOfType(declaration, "VariableDeclaration")) return;

        for (const declarator of declaration.declarations ?? []) {
          if (!isNodeOfType(declarator, "VariableDeclarator")) continue;
          if (!isNodeOfType(declarator.id, "Identifier")) continue;
          if (declarator.id.name !== "runtime") continue;

          const initValue = isNodeOfType(declarator.init, "Literal") ? declarator.init.value : null;

          if (initValue === "edge") {
            context.report({
              node,
              message:
                "Edge runtime limits OG image generation. Node.js runtime supports more fonts, filesystem access, and larger response sizes.",
            });
          }
        }
      },
    };
  },
});
