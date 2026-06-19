import type { Viewport } from "@react-doctor/browser";
import { MAX_VIEWPORT_PX } from "../constants.js";

// Parse a `WIDTHxHEIGHT` string into a viewport, throwing a readable message
// (surfaced as a tool error by `runTool`) on a malformed or out-of-range value.
export const parseViewport = (value: string): Viewport => {
  const match = /^(\d+)x(\d+)$/i.exec(value.trim());
  const width = match ? Number(match[1]) : 0;
  const height = match ? Number(match[2]) : 0;
  if (!match || width === 0 || height === 0) {
    throw new Error(`Use WIDTHxHEIGHT in pixels, e.g. 390x844 (got "${value}").`);
  }
  if (width > MAX_VIEWPORT_PX || height > MAX_VIEWPORT_PX) {
    throw new Error(`Viewport dimensions must be at most ${MAX_VIEWPORT_PX}px.`);
  }
  return { width, height };
};
