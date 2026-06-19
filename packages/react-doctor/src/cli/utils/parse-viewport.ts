import type { Viewport } from "@react-doctor/browser";
import { InvalidArgumentError } from "commander";
import { MAX_VIEWPORT_PX } from "./constants.js";

// Throws Commander's InvalidArgumentError so a bad `--viewport WIDTHxHEIGHT`
// value renders as a clean usage error rather than a crash report.
export const parseViewport = (value: string): Viewport => {
  const match = /^(\d+)x(\d+)$/i.exec(value.trim());
  const width = match ? Number(match[1]) : 0;
  const height = match ? Number(match[2]) : 0;
  if (!match || width === 0 || height === 0) {
    throw new InvalidArgumentError(`Use WIDTHxHEIGHT in pixels, e.g. 390x844 (got "${value}").`);
  }
  if (width > MAX_VIEWPORT_PX || height > MAX_VIEWPORT_PX) {
    throw new InvalidArgumentError(`Viewport dimensions must be at most ${MAX_VIEWPORT_PX}px.`);
  }
  return { width, height };
};
