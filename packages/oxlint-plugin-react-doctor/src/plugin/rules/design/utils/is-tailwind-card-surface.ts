import { getUnvariantClassNameTokens } from "../../../utils/get-unvariant-class-name-tokens.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { getStringFromClassNameAttr } from "./get-string-from-class-name-attr.js";

export const isTailwindCardSurface = (node: EsTreeNodeOfType<"JSXOpeningElement">): boolean => {
  const classNameValue = getStringFromClassNameAttr(node);
  if (!classNameValue) return false;
  const tokens = getUnvariantClassNameTokens(classNameValue);
  const hasRounding = tokens.some(
    (token) => token === "rounded" || (token.startsWith("rounded-") && token !== "rounded-none"),
  );
  const hasBoundary = tokens.some(
    (token) =>
      token === "border" ||
      token.startsWith("border-") ||
      token === "shadow" ||
      token.startsWith("shadow-") ||
      token === "ring" ||
      token.startsWith("ring-"),
  );
  const hasInterior = tokens.some(
    (token) => /^(?:p|px|py)-/.test(token) || token.startsWith("bg-"),
  );
  return hasRounding && hasBoundary && hasInterior;
};
