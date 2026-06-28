import { redactSensitiveText } from "./redact-sensitive-text.js";
import { scrubSensitivePaths } from "./scrub-sensitive-paths.js";

export const anonymizeSensitiveText = (text: string): string =>
  redactSensitiveText(scrubSensitivePaths(text));
