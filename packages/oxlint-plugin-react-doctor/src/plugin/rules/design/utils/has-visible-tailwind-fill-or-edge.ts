const BORDER_WIDTH_PATTERN = /^border(?:-(px|[\d.]+|\[[\d.]+px\]))?$/;
const RING_WIDTH_PATTERN = /^ring(?:-(px|[\d.]+|\[[\d.]+px\]))?$/;
const NON_SURFACE_BACKGROUND_PATTERN =
  /^bg-(?:auto|center|clip-|contain|cover|fixed|left|local|none|origin-|repeat|right|scroll|top|transparent|\[(?:length|position|size):)/;

const hasPositiveLength = (token: string, pattern: RegExp): boolean => {
  const match = token.match(pattern);
  if (!match) return false;
  if (!match[1] || match[1] === "px") return true;
  return parseFloat(match[1].replace(/^\[|px\]$/g, "")) > 0;
};

export const hasVisibleTailwindFillOrEdge = (tokens: string[]): boolean => {
  const hasVisibleBorder =
    !tokens.some((token) => /^(?:border-(?:opacity-0|transparent)|border-.+\/0)$/.test(token)) &&
    tokens.some((token) => hasPositiveLength(token, BORDER_WIDTH_PATTERN));
  const hasVisibleRing =
    !tokens.some((token) => /^(?:ring-(?:opacity-0|transparent)|ring-.+\/0)$/.test(token)) &&
    tokens.some((token) => hasPositiveLength(token, RING_WIDTH_PATTERN));
  const hasVisibleBackground =
    !tokens.some((token) => /^(?:bg-opacity-0|bg-(?:\[transparent\]|.+\/0))$/.test(token)) &&
    tokens.some((token) => token.startsWith("bg-") && !NON_SURFACE_BACKGROUND_PATTERN.test(token));
  return hasVisibleBorder || hasVisibleRing || hasVisibleBackground;
};
