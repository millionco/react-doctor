import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { getReactDoctorStringSetting } from "../../utils/get-react-doctor-setting.js";
import { getStaticProjectDomIds } from "../../utils/get-static-project-dom-ids.js";
import { getStringLiteralAttributeValue } from "../../utils/get-string-literal-attribute-value.js";
import { resolveJsxElementType } from "../../utils/resolve-jsx-element-type.js";

interface PendingFragmentLink {
  readonly hrefAttribute: EsTreeNodeOfType<"JSXAttribute">;
  readonly targetId: string;
}

export const anchorTargetExists = defineRule({
  id: "anchor-target-exists",
  title: "Fragment link target is missing",
  severity: "warn",
  recommendation:
    "Add an element with the referenced id, or update the fragment link to point to an existing target.",
  create: (context) => {
    const pendingFragmentLinks: PendingFragmentLink[] = [];
    let programNode: EsTreeNodeOfType<"Program"> | null = null;

    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        programNode = node;
      },
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (resolveJsxElementType(node) !== "a") return;
        const hrefAttribute = getAuthoritativeJsxAttribute(node.attributes, "href", false);
        if (!hrefAttribute) return;
        const href = getStringLiteralAttributeValue(hrefAttribute);
        if (!href?.startsWith("#") || href.length === 1) return;
        pendingFragmentLinks.push({ hrefAttribute, targetId: href.slice(1) });
      },
      "Program:exit"() {
        if (!programNode || pendingFragmentLinks.length === 0) return;
        const staticProjectDomIds = getStaticProjectDomIds({
          configuredRootDirectory: getReactDoctorStringSetting(context.settings, "rootDirectory"),
          currentFilePath: context.filename ?? "",
          currentProgramNode: programNode,
          currentScopes: context.scopes,
        });
        if (!staticProjectDomIds) return;
        for (const pendingFragmentLink of pendingFragmentLinks) {
          if (staticProjectDomIds.has(pendingFragmentLink.targetId)) continue;
          context.report({
            node: pendingFragmentLink.hrefAttribute,
            message: `This fragment link points to "#${pendingFragmentLink.targetId}", but no matching static id was found in the project.`,
          });
        }
      },
    };
  },
});
