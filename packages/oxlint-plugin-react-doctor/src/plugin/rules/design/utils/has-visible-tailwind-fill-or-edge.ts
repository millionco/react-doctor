import { getLastMatchingToken } from "./get-last-matching-token.js";

const BORDER_WIDTH_PATTERN = /^border(?:-[trblxy])?(?:-(px|[\d.]+|\[[\d.]+px\]))?$/;
const CLOSED_BORDER_WIDTH_PATTERN = /^border(?:-(px|[\d.]+|\[[\d.]+px\]))?$/;
const RING_WIDTH_PATTERN = /^ring(?:-(px|[\d.]+|\[[\d.]+px\]))?$/;
const SHADOW_GEOMETRY_PATTERN =
  /^shadow(?:-(?:2xl|inner|lg|md|sm|xl|xs)|-\[(?=[^\]]*(?:em|px|rem))[^\]]+\])?$/;
const NON_SURFACE_BACKGROUND_PATTERN =
  /^bg-(?:auto|center|clip-|contain|cover|fixed|left|local|none|origin-|repeat|right|scroll|top|transparent|\[(?:length|position|size):)/;

const hasPositiveLength = (token: string, pattern: RegExp): boolean => {
  const match = token.match(pattern);
  if (!match) return false;
  if (!match[1] || match[1] === "px") return true;
  return parseFloat(match[1].replace(/^\[|px\]$/g, "")) > 0;
};

export const hasVisibleTailwindBorder = (tokens: string[]): boolean =>
  !tokens.some((token) =>
    /^(?:border(?:-[trblxy])?-(?:opacity-0|transparent)|border(?:-[trblxy])?-.+\/0)$/.test(token),
  ) && tokens.some((token) => hasPositiveLength(token, BORDER_WIDTH_PATTERN));

export const hasVisibleTailwindClosedBorder = (tokens: string[]): boolean =>
  !tokens.some((token) =>
    /^(?:border(?:-[trblxy])?-(?:0|none|opacity-0|transparent)|border(?:-[trblxy])?-.+\/0)$/.test(
      token,
    ),
  ) && tokens.some((token) => hasPositiveLength(token, CLOSED_BORDER_WIDTH_PATTERN));

export const hasVisibleTailwindRing = (tokens: string[]): boolean =>
  !tokens.some((token) => /^(?:ring-(?:opacity-0|transparent)|ring-.+\/0)$/.test(token)) &&
  tokens.some((token) => hasPositiveLength(token, RING_WIDTH_PATTERN));

export const hasVisibleTailwindBackground = (tokens: string[]): boolean => {
  const effectiveBackgroundOpacity = getLastMatchingToken(tokens, (token) =>
    token.startsWith("bg-opacity-"),
  );
  if (effectiveBackgroundOpacity === "bg-opacity-0") return false;
  const effectiveBackground = getLastMatchingToken(
    tokens,
    (token) =>
      token === "bg-transparent" ||
      (token.startsWith("bg-") &&
        !token.startsWith("bg-opacity-") &&
        !NON_SURFACE_BACKGROUND_PATTERN.test(token)),
  );
  return Boolean(
    effectiveBackground &&
    !/^(?:bg-transparent|bg-\[transparent\]|bg-.+\/0)$/.test(effectiveBackground),
  );
};

export const hasVisibleTailwindShadow = (tokens: string[]): boolean =>
  !tokens.some((token) => /^(?:shadow-(?:none|transparent)|shadow-.+\/0)$/.test(token)) &&
  tokens.some((token) => SHADOW_GEOMETRY_PATTERN.test(token));

export const hasVisibleTailwindFillOrEdge = (tokens: string[]): boolean =>
  hasVisibleTailwindBorder(tokens) ||
  hasVisibleTailwindRing(tokens) ||
  hasVisibleTailwindBackground(tokens);

export const hasVisibleTailwindClosedSurface = (tokens: string[]): boolean =>
  hasVisibleTailwindClosedBorder(tokens) ||
  hasVisibleTailwindRing(tokens) ||
  hasVisibleTailwindBackground(tokens);

export const hasVisibleTailwindBoundary = (tokens: string[]): boolean =>
  hasVisibleTailwindBorder(tokens) ||
  hasVisibleTailwindRing(tokens) ||
  hasVisibleTailwindShadow(tokens);
