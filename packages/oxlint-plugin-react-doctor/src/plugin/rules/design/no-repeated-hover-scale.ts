import { REPEATED_HOVER_SCALE_MIN_COUNT } from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import { getStaticJsxOpeningElements } from "../../utils/get-static-jsx-opening-elements.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getTailwindVariantUtilities } from "../../utils/get-tailwind-variant-utilities.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import { isTopLevelPageCopyRoot } from "./utils/is-top-level-page-copy-root.js";

const HOVER_SCALE_PATTERN = /^scale-(?!100(?:$|\D))/;

export const noRepeatedHoverScale = defineRule({
  id: "no-repeated-hover-scale",
  title: "Hover scaling repeats across the page",
  severity: "warn",
  defaultEnabled: false,
  tags: ["design", "test-noise"],
  recommendation:
    "Reserve hover movement for a specific spatial interaction instead of making unrelated cards and tiles all grow under the pointer.",
  create: (context: RuleContext) => ({
    JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
      if (!isTopLevelPageCopyRoot(node)) return;
      const candidatesByUtility = new Map<string, Array<EsTreeNodeOfType<"JSXOpeningElement">>>();
      for (const openingElement of getStaticJsxOpeningElements(node)) {
        const classNameValue = getStringFromClassNameAttr(openingElement);
        if (!classNameValue) continue;
        const hoverScale = getTailwindVariantUtilities(classNameValue, "hover").find((utility) =>
          HOVER_SCALE_PATTERN.test(utility),
        );
        if (!hoverScale) continue;
        const candidates = candidatesByUtility.get(hoverScale) ?? [];
        candidates.push(openingElement);
        candidatesByUtility.set(hoverScale, candidates);
      }
      for (const [utility, candidates] of candidatesByUtility) {
        if (candidates.length < REPEATED_HOVER_SCALE_MIN_COUNT) continue;
        context.report({
          node: candidates[0],
          message: `The ${utility} hover treatment repeats on ${candidates.length} elements. Use stable surfaces or vary feedback by interaction purpose.`,
        });
      }
    },
  }),
});
