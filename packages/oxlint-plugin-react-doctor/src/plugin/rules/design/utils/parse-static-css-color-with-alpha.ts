import {
  CSS_ALPHA_PERCENT_SCALE,
  CSS_HEX_ALPHA_BYTE_MAX,
  CSS_HEX_ALPHA_NIBBLE_MAX,
} from "../../../constants/design.js";
import { getCssFunctionContents } from "./get-css-function-contents.js";
import { parseColorToRgb } from "./parse-color-to-rgb.js";
import { splitCssTopLevel } from "./split-css-top-level.js";

export interface StaticCssColorWithAlpha {
  alpha: number;
  blue: number;
  green: number;
  red: number;
}

const CSS_ALPHA_VALUE_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?%?$/i;

const parseAlpha = (value: string): number | null => {
  const trimmedValue = value.trim();
  if (!CSS_ALPHA_VALUE_PATTERN.test(trimmedValue)) return null;
  const numericValue = Number.parseFloat(trimmedValue);
  if (!Number.isFinite(numericValue)) return null;
  const alpha = trimmedValue.endsWith("%") ? numericValue / CSS_ALPHA_PERCENT_SCALE : numericValue;
  return alpha >= 0 && alpha <= 1 ? alpha : null;
};

const parseFunctionalColorAlpha = (colorValue: string): number | null => {
  const contents = getCssFunctionContents(colorValue);
  if (contents === null) return null;
  const slashParts = splitCssTopLevel(contents, "/");
  if (!slashParts || slashParts.length > 2) return null;
  if (slashParts.length === 2) return parseAlpha(slashParts[1]);
  const commaParts = splitCssTopLevel(contents, ",");
  if (!commaParts) return null;
  return commaParts.length === 4 ? parseAlpha(commaParts[3]) : 1;
};

export const parseStaticCssColorWithAlpha = (
  colorValue: string,
): StaticCssColorWithAlpha | null => {
  const normalizedColor = colorValue.trim().toLowerCase();
  if (normalizedColor === "transparent") {
    return { alpha: 0, blue: 0, green: 0, red: 0 };
  }
  const parsedRgb = parseColorToRgb(normalizedColor);
  if (!parsedRgb) return null;
  let alpha = 1;
  if (/^#[\da-f]{4}$/i.test(normalizedColor)) {
    alpha = Number.parseInt(normalizedColor.slice(4), 16) / CSS_HEX_ALPHA_NIBBLE_MAX;
  } else if (/^#[\da-f]{8}$/i.test(normalizedColor)) {
    alpha = Number.parseInt(normalizedColor.slice(7), 16) / CSS_HEX_ALPHA_BYTE_MAX;
  } else if (/^(?:rgb|hsl)a?\(/i.test(normalizedColor)) {
    const functionalAlpha = parseFunctionalColorAlpha(normalizedColor);
    if (functionalAlpha === null) return null;
    alpha = functionalAlpha;
  }
  return { ...parsedRgb, alpha };
};
