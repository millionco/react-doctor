import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import { getStringLiteralAttributeValue } from "../../utils/get-string-literal-attribute-value.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import { getStaticJsxTreeRoot } from "../../utils/get-static-jsx-tree-root.js";
import { resolveJsxElementType } from "../../utils/resolve-jsx-element-type.js";
import type { RuleContext } from "../../utils/rule-context.js";

const getLandmarkName = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
): string | null | undefined => {
  for (const attributeName of ["aria-label", "aria-labelledby"]) {
    const attribute = findJsxAttribute(node.attributes, attributeName);
    if (!attribute) continue;
    return getStringLiteralAttributeValue(attribute) ?? undefined;
  }
  return hasJsxSpreadAttribute(node.attributes) ? undefined : null;
};

export const noMultipleUnlabeledNavigationLandmarks = defineRule({
  id: "no-multiple-unlabeled-navigation-landmarks",
  title: "Repeated navigation landmarks need unique names",
  severity: "warn",
  category: "Accessibility",
  recommendation:
    "Give each coexisting navigation landmark a concise, unique aria-label or aria-labelledby value.",
  create: (context: RuleContext) => {
    const landmarksByRoot = new Map<EsTreeNode, Array<EsTreeNodeOfType<"JSXOpeningElement">>>();
    return {
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (resolveJsxElementType(node) !== "nav") return;
        const root = getStaticJsxTreeRoot(node);
        if (!root) return;
        const landmarks = landmarksByRoot.get(root) ?? [];
        landmarks.push(node);
        landmarksByRoot.set(root, landmarks);
      },
      "Program:exit"() {
        for (const landmarks of landmarksByRoot.values()) {
          if (landmarks.length < 2) continue;
          const seenNames = new Set<string>();
          for (const landmark of landmarks) {
            const landmarkName = getLandmarkName(landmark);
            if (landmarkName === undefined) continue;
            if (landmarkName === null || seenNames.has(landmarkName.toLowerCase())) {
              context.report({
                node: landmark,
                message:
                  "This navigation landmark is indistinguishable from another landmark in the same view. Give each one a unique accessible name.",
              });
              continue;
            }
            seenNames.add(landmarkName.toLowerCase());
          }
        }
      },
    };
  },
});
