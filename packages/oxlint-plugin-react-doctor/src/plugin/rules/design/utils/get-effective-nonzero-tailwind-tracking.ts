import { getEffectiveTailwindClassNameToken } from "./get-effective-tailwind-class-name-token.js";

const TRACKING_UTILITY_PATTERN = /^-?tracking-/;
const STATIC_TRACKING_UTILITIES = new Set([
  "tracking-tight",
  "tracking-tighter",
  "tracking-wide",
  "tracking-wider",
  "tracking-widest",
]);
const NONZERO_ARBITRARY_TRACKING_PATTERN =
  /^-?tracking-\[(?:length:)?(-?(?:\d+(?:\.\d*)?|\.\d+))(?:cap|ch|cm|dvh|dvw|em|ex|ic|in|lh|lvh|lvw|mm|pc|pt|px|q|rcap|rch|rem|rex|ric|rlh|svh|svw|vb|vh|vi|vmax|vmin|vw)\]$/i;

export const getEffectiveNonzeroTailwindTracking = (tokens: string[]): string | null => {
  const effectiveTracking = getEffectiveTailwindClassNameToken(tokens, (utility) =>
    TRACKING_UTILITY_PATTERN.test(utility),
  );
  if (!effectiveTracking) return null;
  if (STATIC_TRACKING_UTILITIES.has(effectiveTracking)) return effectiveTracking;
  const arbitraryTracking = effectiveTracking.match(NONZERO_ARBITRARY_TRACKING_PATTERN);
  return arbitraryTracking && Number.parseFloat(arbitraryTracking[1]) !== 0
    ? effectiveTracking
    : null;
};
