import { getUnvariantClassNameTokens } from "../../../utils/get-unvariant-class-name-tokens.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { getStringFromClassNameAttr } from "./get-string-from-class-name-attr.js";

const COMPLETE_ROUNDING_PATTERN = /^rounded(?:-(?:[2-9]xl|full|lg|md|sm|xl|xs|\[[^\]]+\]))?$/;
const BORDER_WIDTH_PATTERN = /^border(?:-(px|[\d.]+|\[[\d.]+px\]))?$/;
const RING_WIDTH_PATTERN = /^ring(?:-(px|[\d.]+|\[[\d.]+px\]))?$/;
const SHADOW_GEOMETRY_PATTERN =
  /^shadow(?:-(?:2xl|inner|lg|md|sm|xl|xs)|-\[(?=[^\]]*(?:em|px|rem))[^\]]+\])?$/;
const PADDING_PATTERN = /^p[trblesxy]?-(px|[\d.]+|\[[\d.]+(?:px|rem)\])$/;
const NON_SURFACE_BACKGROUND_PATTERN =
  /^bg-(?:auto|center|clip-|contain|cover|fixed|left|local|none|origin-|repeat|right|scroll|top|transparent|\[(?:length|position|size):)/;

const hasPositiveLength = (token: string, pattern: RegExp): boolean => {
  const match = token.match(pattern);
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
  const hasVisibleBorder =
    !tokens.some((token) => /^(?:border-(?:opacity-0|transparent)|border-.+\/0)$/.test(token)) &&
    tokens.some((token) => hasPositiveLength(token, BORDER_WIDTH_PATTERN));
  const hasVisibleRing =
    !tokens.some((token) => /^(?:ring-(?:opacity-0|transparent)|ring-.+\/0)$/.test(token)) &&
    tokens.some((token) => hasPositiveLength(token, RING_WIDTH_PATTERN));
  const hasVisibleShadow =
    !tokens.some((token) => /^(?:shadow-(?:none|transparent)|shadow-.+\/0)$/.test(token)) &&
    tokens.some((token) => SHADOW_GEOMETRY_PATTERN.test(token));
  const hasBoundary = hasVisibleBorder || hasVisibleRing || hasVisibleShadow;
  const hasVisibleBackground =
    !tokens.some((token) => /^(?:bg-opacity-0|bg-(?:\[transparent\]|.+\/0))$/.test(token)) &&
    tokens.some((token) => token.startsWith("bg-") && !NON_SURFACE_BACKGROUND_PATTERN.test(token));
  const hasInterior =
    tokens.some((token) => hasPositiveLength(token, PADDING_PATTERN)) || hasVisibleBackground;
  return hasRounding && hasBoundary && hasInterior;
};
