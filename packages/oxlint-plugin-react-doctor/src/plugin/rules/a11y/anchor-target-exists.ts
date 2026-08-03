import { EMPTY_RULE_VISITORS } from "../../utils/empty-rule-visitors.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getElementType } from "../../utils/get-element-type.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { getJsxA11yHrefAttributeNames } from "../../utils/get-jsx-a11y-href-attribute-names.js";
import { getReactDoctorStringSetting } from "../../utils/get-react-doctor-setting.js";
import { getStaticProjectDomIds } from "../../utils/get-static-project-dom-ids.js";
import { getStringLiteralAttributeValue } from "../../utils/get-string-literal-attribute-value.js";
import { isTestlikeFilename } from "../../utils/is-testlike-filename.js";

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
    if (isTestlikeFilename(context.filename)) return EMPTY_RULE_VISITORS;
    const pendingFragmentLinks: PendingFragmentLink[] = [];
    let programNode: EsTreeNodeOfType<"Program"> | null = null;

    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        programNode = node;
      },
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (getElementType(node, context.settings) !== "a") return;
        let hrefAttribute: EsTreeNodeOfType<"JSXAttribute"> | null = null;
        for (const hrefAttributeName of getJsxA11yHrefAttributeNames(context.settings)) {
          hrefAttribute = getAuthoritativeJsxAttribute(node.attributes, hrefAttributeName, false);
          if (hrefAttribute) break;
        }
        if (!hrefAttribute) return;
        const href = getStringLiteralAttributeValue(hrefAttribute);
        if (
          !href?.startsWith("#") ||
          href.length === 1 ||
          href.startsWith("#/") ||
          href.startsWith("#!")
        ) {
          return;
        }
        const textFragmentDirectiveIndex = href.indexOf(":~:");
        const targetId = href.slice(
          1,
          textFragmentDirectiveIndex === -1 ? undefined : textFragmentDirectiveIndex,
        );
        if (!targetId || targetId.toLowerCase() === "top") return;
        pendingFragmentLinks.push({ hrefAttribute, targetId });
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
