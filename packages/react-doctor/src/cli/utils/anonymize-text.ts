import { isPlainObject, redactSensitiveText } from "@react-doctor/core";
import { scrubSensitivePaths } from "./scrub-sensitive-text.js";

/**
 * Free-text fields can carry both a home-directory path (the OS username) and a
 * secret/email echoed from user code, so run both scrubbers: strip the username
 * from paths, then mask any known credential/PII shape. Shared by the Sentry
 * event scrubber ({@link scrubSentryEvent}) and metric scrubber
 * ({@link scrubSentryMetric}).
 */
export const anonymizeText = (text: string): string =>
  redactSensitiveText(scrubSensitivePaths(text));

/**
 * Recursively rewrites every string within an arbitrary value (object / array /
 * primitive) through {@link anonymizeText}, mutating in place. Used to sweep the
 * unstructured corners of a Sentry payload (event contexts/extra/tags, breadcrumb
 * data, span attributes, metric attributes) where a path or secret could hide.
 */
export const anonymizeInPlace = (value: unknown): void => {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const item = value[index];
      if (typeof item === "string") value[index] = anonymizeText(item);
      else anonymizeInPlace(item);
    }
    return;
  }
  if (!isPlainObject(value)) return;
  for (const key of Object.keys(value)) {
    const inner = value[key];
    if (typeof inner === "string") value[key] = anonymizeText(inner);
    else anonymizeInPlace(inner);
  }
};
