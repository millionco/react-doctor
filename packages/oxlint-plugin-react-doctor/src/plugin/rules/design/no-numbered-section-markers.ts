import { REPEATED_DECORATIVE_LABEL_MIN_COUNT } from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import { getNextStaticJsxElementSibling } from "../../utils/get-next-static-jsx-element-sibling.js";
import { getStaticJsxText } from "../../utils/get-static-jsx-text.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";

const NUMBERED_MARKER_PATTERN = /^(0[1-9]|1[0-2])$/;
const HEADING_ELEMENT_PATTERN = /^h[1-6]$/;

const getSectionMarker = (node: EsTreeNodeOfType<"JSXElement">): number | null => {
  const text = getStaticJsxText(node).trim();
  const match = text.match(NUMBERED_MARKER_PATTERN);
  if (!match) return null;
  const sibling = getNextStaticJsxElementSibling(node);
  if (
    !sibling ||
    !isNodeOfType(sibling.openingElement.name, "JSXIdentifier") ||
    !HEADING_ELEMENT_PATTERN.test(sibling.openingElement.name.name)
  ) {
    return null;
  }
  return parseInt(match[1], 10);
};

export const noNumberedSectionMarkers = defineRule({
  id: "no-numbered-section-markers",
  title: "Sequential numbers are used as section decoration",
  severity: "warn",
  defaultEnabled: false,
  tags: ["design", "test-noise"],
  recommendation:
    "Remove decorative section numbering unless the sequence communicates real progress or ordered steps.",
  create: (context: RuleContext) => {
    const markers = new Map<number, EsTreeNodeOfType<"JSXOpeningElement">>();
    return {
      JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
        const marker = getSectionMarker(node);
        if (marker === null) return;
        markers.set(marker, node.openingElement);
      },
      "Program:exit"() {
        const sortedMarkers = [...markers.keys()].sort((left, right) => left - right);
        let runStartIndex = 0;
        for (let markerIndex = 1; markerIndex <= sortedMarkers.length; markerIndex += 1) {
          const continuesRun =
            markerIndex < sortedMarkers.length &&
            sortedMarkers[markerIndex] === sortedMarkers[markerIndex - 1] + 1;
          if (continuesRun) continue;
          const runLength = markerIndex - runStartIndex;
          if (runLength >= REPEATED_DECORATIVE_LABEL_MIN_COUNT) {
            const firstNode = markers.get(sortedMarkers[runStartIndex]);
            if (firstNode) {
              context.report({
                node: firstNode,
                message:
                  "Several headings are prefixed with decorative sequence numbers. Keep numbering for genuinely ordered steps, not visual scaffolding.",
              });
            }
            return;
          }
          runStartIndex = markerIndex;
        }
      },
    };
  },
});
