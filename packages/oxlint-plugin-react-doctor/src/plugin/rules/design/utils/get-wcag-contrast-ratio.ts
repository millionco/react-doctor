import type { ParsedRgb } from "../../../utils/parsed-rgb.js";

// WCAG 2.1 relative luminance: linearize each sRGB channel, then weight.
const linearizeChannel = (channel: number): number => {
  const normalized = channel / 255;
  return normalized <= 0.03928 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
};

const relativeLuminance = (color: ParsedRgb): number =>
  0.2126 * linearizeChannel(color.red) +
  0.7152 * linearizeChannel(color.green) +
  0.0722 * linearizeChannel(color.blue);

// WCAG 2.1 contrast ratio between two opaque colors, in [1, 21].
export const getWcagContrastRatio = (foreground: ParsedRgb, background: ParsedRgb): number => {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
};
