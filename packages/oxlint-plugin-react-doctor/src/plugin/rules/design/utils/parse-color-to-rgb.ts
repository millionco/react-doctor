import type { ParsedRgb } from "../../../utils/parsed-rgb.js";

const FULL_HUE_DEGREES = 360;
const HUE_SEXTANT_DEGREES = 60;
const MAX_RGB_CHANNEL_VALUE = 255;
const PERCENT_SCALE = 100;

const convertHslToRgb = (
  hueDegrees: number,
  saturationPercent: number,
  lightnessPercent: number,
): ParsedRgb => {
  const hue = ((hueDegrees % FULL_HUE_DEGREES) + FULL_HUE_DEGREES) % FULL_HUE_DEGREES;
  const saturation = saturationPercent / PERCENT_SCALE;
  const lightness = lightnessPercent / PERCENT_SCALE;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const secondary = chroma * (1 - Math.abs(((hue / HUE_SEXTANT_DEGREES) % 2) - 1));
  const lightnessOffset = lightness - chroma / 2;
  const sextant = Math.floor(hue / HUE_SEXTANT_DEGREES);
  const channelTriples: ReadonlyArray<readonly [number, number, number]> = [
    [chroma, secondary, 0],
    [secondary, chroma, 0],
    [0, chroma, secondary],
    [0, secondary, chroma],
    [secondary, 0, chroma],
    [chroma, 0, secondary],
  ];
  const [redChannel, greenChannel, blueChannel] = channelTriples[sextant] ?? channelTriples[0];
  return {
    red: Math.round((redChannel + lightnessOffset) * MAX_RGB_CHANNEL_VALUE),
    green: Math.round((greenChannel + lightnessOffset) * MAX_RGB_CHANNEL_VALUE),
    blue: Math.round((blueChannel + lightnessOffset) * MAX_RGB_CHANNEL_VALUE),
  };
};

export const parseColorToRgb = (value: string): ParsedRgb | null => {
  // HACK: Tailwind arbitrary values spell spaces as underscores
  // (`border-[rgb(229_231_235)]`), so normalize before matching.
  const trimmed = value.trim().toLowerCase().replace(/_/g, " ");

  if (trimmed.startsWith("#")) {
    const hex8Match = trimmed.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})[0-9a-f]{2}$/);
    if (hex8Match) {
      return {
        red: parseInt(hex8Match[1], 16),
        green: parseInt(hex8Match[2], 16),
        blue: parseInt(hex8Match[3], 16),
      };
    }

    const hex6Match = trimmed.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/);
    if (hex6Match) {
      return {
        red: parseInt(hex6Match[1], 16),
        green: parseInt(hex6Match[2], 16),
        blue: parseInt(hex6Match[3], 16),
      };
    }

    const hex4Match = trimmed.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])[0-9a-f]$/);
    if (hex4Match) {
      return {
        red: parseInt(hex4Match[1] + hex4Match[1], 16),
        green: parseInt(hex4Match[2] + hex4Match[2], 16),
        blue: parseInt(hex4Match[3] + hex4Match[3], 16),
      };
    }

    const hex3Match = trimmed.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/);
    if (hex3Match) {
      return {
        red: parseInt(hex3Match[1] + hex3Match[1], 16),
        green: parseInt(hex3Match[2] + hex3Match[2], 16),
        blue: parseInt(hex3Match[3] + hex3Match[3], 16),
      };
    }
  }

  if (trimmed.includes("rgb")) {
    const rgbMatch = trimmed.match(/rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/);
    if (rgbMatch) {
      return {
        red: parseInt(rgbMatch[1], 10),
        green: parseInt(rgbMatch[2], 10),
        blue: parseInt(rgbMatch[3], 10),
      };
    }
  }

  if (trimmed.includes("hsl")) {
    const hslMatch = trimmed.match(/hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%/);
    if (hslMatch) {
      return convertHslToRgb(
        parseFloat(hslMatch[1]),
        parseFloat(hslMatch[2]),
        parseFloat(hslMatch[3]),
      );
    }
  }

  return null;
};
