import { MAX_VIEWPORT_PX } from "./constants.js";
import type { Viewport } from "./types.js";

// Parse a `WIDTHxHEIGHT` string (e.g. 390x844) into a viewport, throwing a
// readable Error on a malformed or out-of-range value. Pure (no playwright), so
// both the CLI's `--viewport` parser and the MCP tool reuse it without dragging
// the browser engine into their bundles.
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
