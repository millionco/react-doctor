import {
  PUBLIC_ENV_SECRET_NAME_PATTERN,
  TRUSTED_PUBLIC_SECRET_NAME_PATTERN,
} from "../../../constants/security.js";
import { escapeRegExp } from "./escape-reg-exp.js";

// Returns a RegExp matching the first suspicious name so callers can
// locate the finding in the file content; `undefined` when every
// public-prefixed env name in the content is a trusted/publishable one.
export const findSuspiciousPublicEnvSecretNamePattern = (content: string): RegExp | undefined => {
  for (const match of content.matchAll(new RegExp(PUBLIC_ENV_SECRET_NAME_PATTERN.source, "gi"))) {
    const value = match[0] ?? "";
    if (!TRUSTED_PUBLIC_SECRET_NAME_PATTERN.test(value)) {
      return new RegExp(escapeRegExp(value));
    }
  }
  return undefined;
};
