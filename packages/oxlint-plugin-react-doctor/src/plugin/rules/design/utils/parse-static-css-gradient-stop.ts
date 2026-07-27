import type { StaticCssColorWithAlpha } from "./parse-static-css-color-with-alpha.js";
import { parseStaticCssColorWithAlpha } from "./parse-static-css-color-with-alpha.js";

export interface StaticCssGradientStop {
  color: StaticCssColorWithAlpha;
  positions: string[];
}

const CSS_STOP_POSITION_PATTERN =
  /^(?:0|[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:%|px|rem))(?:\s+(?:0|[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:%|px|rem)))?$/i;

export const parseStaticCssGradientStop = (stop: string): StaticCssGradientStop | null => {
  const trimmedStop = stop.trim();
  const functionalColorMatch = trimmedStop.match(/^(?:rgb|hsl)a?\(/i);
  if (functionalColorMatch) {
    let depth = 0;
    for (
      let characterIndex = functionalColorMatch[0].length - 1;
      characterIndex < trimmedStop.length;
      characterIndex += 1
    ) {
      const character = trimmedStop[characterIndex];
      if (character === "(") depth += 1;
      if (character === ")") depth -= 1;
      if (depth !== 0) continue;
      const colorValue = trimmedStop.slice(0, characterIndex + 1);
      const positionValue = trimmedStop.slice(characterIndex + 1).trim();
      if (positionValue && !CSS_STOP_POSITION_PATTERN.test(positionValue)) return null;
      const color = parseStaticCssColorWithAlpha(colorValue);
      return color ? { color, positions: positionValue ? positionValue.split(/\s+/) : [] } : null;
    }
    return null;
  }
  const colorMatch = trimmedStop.match(/^(?:transparent|#[\da-f]{3,8})(?:\s+|$)/i);
  if (!colorMatch) return null;
  const colorValue = colorMatch[0].trim();
  const positionValue = trimmedStop.slice(colorMatch[0].length).trim();
  if (positionValue && !CSS_STOP_POSITION_PATTERN.test(positionValue)) return null;
  const color = parseStaticCssColorWithAlpha(colorValue);
  return color ? { color, positions: positionValue ? positionValue.split(/\s+/) : [] } : null;
};
