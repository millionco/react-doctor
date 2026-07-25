import { getCssFunctionContents } from "./get-css-function-contents.js";
import type { StaticCssGradientStop } from "./parse-static-css-gradient-stop.js";
import { parseStaticCssGradientStop } from "./parse-static-css-gradient-stop.js";
import { splitCssTopLevel } from "./split-css-top-level.js";

const RADIAL_GRADIENT_PRELUDE_PATTERN =
  /\b(?:at|circle|closest-corner|closest-side|ellipse|farthest-corner|farthest-side)\b/i;

export const parseStaticRadialGradient = (
  backgroundValue: string,
): StaticCssGradientStop[] | null => {
  const normalizedValue = backgroundValue.trim();
  if (!/^radial-gradient\(/i.test(normalizedValue)) return null;
  const gradientContents = getCssFunctionContents(normalizedValue);
  if (gradientContents === null) return null;
  const gradientParts = splitCssTopLevel(gradientContents, ",");
  if (!gradientParts || gradientParts.length < 2) return null;
  const firstStop = parseStaticCssGradientStop(gradientParts[0]);
  if (!firstStop && !RADIAL_GRADIENT_PRELUDE_PATTERN.test(gradientParts[0])) return null;
  const stopParts = firstStop ? gradientParts : gradientParts.slice(1);
  if (stopParts.length < 2) return null;
  const parsedStops = stopParts.map(parseStaticCssGradientStop);
  return parsedStops.every((stop): stop is StaticCssGradientStop => stop !== null)
    ? parsedStops
    : null;
};
