import { parseViewport as parseViewportValue, type Viewport } from "@react-doctor/browser";
import { InvalidArgumentError } from "commander";

// Reuse the browser package's pure parser, rethrowing as Commander's
// InvalidArgumentError so a bad `--viewport WIDTHxHEIGHT` renders as a clean
// usage error rather than a crash report.
export const parseViewport = (value: string): Viewport => {
  try {
    return parseViewportValue(value);
  } catch (error: unknown) {
    throw new InvalidArgumentError(error instanceof Error ? error.message : String(error));
  }
};
