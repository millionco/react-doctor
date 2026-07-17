import { getUnvariantClassNameTokens } from "../../../utils/get-unvariant-class-name-tokens.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { getStringFromClassNameAttr } from "./get-string-from-class-name-attr.js";
import {
  hasVisibleTailwindBackground,
  hasVisibleTailwindBoundary,
} from "./has-visible-tailwind-fill-or-edge.js";

const COMPLETE_ROUNDING_PATTERN = /^rounded(?:-(?:[2-9]xl|full|lg|md|sm|xl|xs|\[[^\]]+\]))?$/;
const PADDING_PATTERN = /^p[trblesxy]?-(px|[\d.]+|\[[\d.]+(?:px|rem)\])$/;

const hasPositivePadding = (token: string): boolean => {
  const match = token.match(PADDING_PATTERN);
  if (!match) return false;
  if (!match[1] || match[1] === "px") return true;
  return parseFloat(match[1].replace(/^\[|(?:px|rem)\]$/g, "")) > 0;
};

export const isTailwindCardSurface = (node: EsTreeNodeOfType<"JSXOpeningElement">): boolean => {
  const classNameValue = getStringFromClassNameAttr(node);
  if (!classNameValue) return false;
  const tokens = getUnvariantClassNameTokens(classNameValue);
  const hasRounding =
    !tokens.includes("rounded-none") &&
    tokens.some((token) => COMPLETE_ROUNDING_PATTERN.test(token));
  const hasInterior =
    tokens.some((token) => hasPositivePadding(token)) || hasVisibleTailwindBackground(tokens);
  return hasRounding && hasVisibleTailwindBoundary(tokens) && hasInterior;
};
