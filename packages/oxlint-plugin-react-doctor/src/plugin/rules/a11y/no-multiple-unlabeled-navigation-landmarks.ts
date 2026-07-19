import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import { getStringLiteralAttributeValue } from "../../utils/get-string-literal-attribute-value.js";
import { getTailwindVisibilityAtBreakpoints } from "../../utils/get-tailwind-visibility-at-breakpoints.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import { getStaticJsxTreeRoot } from "../../utils/get-static-jsx-tree-root.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveJsxElementType } from "../../utils/resolve-jsx-element-type.js";
import type { RuleContext } from "../../utils/rule-context.js";

interface LandmarkPlacement {
  opaqueBoundary: EsTreeNodeOfType<"JSXElement"> | null;
  visibility: ReadonlyArray<boolean>;
}

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

const getElementVisibility = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
): ReadonlyArray<boolean> | null => {
  const classNameAttribute = findJsxAttribute(openingElement.attributes, "className");
  if (!classNameAttribute) return getTailwindVisibilityAtBreakpoints("");
  const className = getStringLiteralAttributeValue(classNameAttribute);
  return className === null ? null : getTailwindVisibilityAtBreakpoints(className);
};

const getLandmarkPlacement = (
  landmark: EsTreeNodeOfType<"JSXOpeningElement">,
): LandmarkPlacement | null => {
  const landmarkVisibility = getElementVisibility(landmark);
  if (!landmarkVisibility) return null;
  const combinedVisibility = [...landmarkVisibility];
  let ancestorNode = landmark.parent?.parent;
  while (ancestorNode) {
    if (isNodeOfType(ancestorNode, "JSXElement")) {
      const openingElement = ancestorNode.openingElement;
      const elementType = resolveJsxElementType(openingElement);
      const firstCharacter = elementType[0];
      if (!firstCharacter || firstCharacter !== firstCharacter.toLowerCase()) {
        return { opaqueBoundary: ancestorNode, visibility: combinedVisibility };
      }
      const ancestorVisibility = getElementVisibility(openingElement);
      if (!ancestorVisibility) return null;
      for (
        let breakpointIndex = 0;
        breakpointIndex < combinedVisibility.length;
        breakpointIndex += 1
      ) {
        combinedVisibility[breakpointIndex] =
          combinedVisibility[breakpointIndex] && ancestorVisibility[breakpointIndex];
      }
    }
    ancestorNode = ancestorNode.parent ?? null;
  }
  return { opaqueBoundary: null, visibility: combinedVisibility };
};

const canLandmarksCoexist = (
  firstLandmark: EsTreeNodeOfType<"JSXOpeningElement">,
  secondLandmark: EsTreeNodeOfType<"JSXOpeningElement">,
): boolean => {
  const firstPlacement = getLandmarkPlacement(firstLandmark);
  const secondPlacement = getLandmarkPlacement(secondLandmark);
  if (!firstPlacement || !secondPlacement) return false;
  if (firstPlacement.opaqueBoundary !== secondPlacement.opaqueBoundary) return false;
  return firstPlacement.visibility.some(
    (isFirstVisible, index) => isFirstVisible && secondPlacement.visibility[index],
  );
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
          const conflictingLandmarks = new Set<EsTreeNodeOfType<"JSXOpeningElement">>();
          for (let firstIndex = 0; firstIndex < landmarks.length; firstIndex += 1) {
            const firstLandmark = landmarks[firstIndex];
            const firstName = getLandmarkName(firstLandmark);
            for (
              let secondIndex = firstIndex + 1;
              secondIndex < landmarks.length;
              secondIndex += 1
            ) {
              const secondLandmark = landmarks[secondIndex];
              if (!canLandmarksCoexist(firstLandmark, secondLandmark)) continue;
              const secondName = getLandmarkName(secondLandmark);
              if (firstName === undefined || secondName === undefined) continue;
              if (firstName === null) conflictingLandmarks.add(firstLandmark);
              if (secondName === null) conflictingLandmarks.add(secondLandmark);
              if (
                firstName !== null &&
                secondName !== null &&
                firstName.toLowerCase() === secondName.toLowerCase()
              ) {
                conflictingLandmarks.add(secondLandmark);
              }
            }
          }
          for (const landmark of conflictingLandmarks) {
            context.report({
              node: landmark,
              message:
                "This navigation landmark is indistinguishable from another landmark in the same view. Give each one a unique accessible name.",
            });
          }
        }
      },
    };
  },
});
