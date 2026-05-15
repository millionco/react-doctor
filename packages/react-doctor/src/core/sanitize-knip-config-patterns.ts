import { isPlainObject } from "./is-plain-object.js";

const isMeaningfulPattern = (value: unknown): boolean =>
  typeof value !== "string" || value.trim().length > 0;

const sanitizeStringArray = (values: unknown[]): unknown[] =>
  values.filter((entry) => (typeof entry === "string" ? entry.trim().length > 0 : true));

// HACK: knip funnels every pattern through picomatch which throws
// `Expected pattern to be a non-empty string` if any entry is `""`.
// Empty strings can sneak in via tsconfig/package.json fields, knip
// configs, or plugin shorthand resolution (issue #149). Walk the
// parsed config and strip empty/whitespace-only patterns so the bad
// entry doesn't take down the whole dead-code step.
export const sanitizeKnipConfigPatterns = (parsedConfig: Record<string, unknown>): void => {
  for (const [key, value] of Object.entries(parsedConfig)) {
    if (typeof value === "string") {
      if (!isMeaningfulPattern(value)) delete parsedConfig[key];
      continue;
    }
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      const sanitized = sanitizeStringArray(value);
      if (sanitized.length === value.length) continue;
      if (sanitized.length === 0) {
        delete parsedConfig[key];
      } else {
        parsedConfig[key] = sanitized;
      }
      continue;
    }
    if (isPlainObject(value)) {
      sanitizeKnipConfigPatterns(value);
    }
  }
};
