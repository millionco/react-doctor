import {
  SECRET_CONTEXTUAL_PLACEHOLDER_VALUE_PATTERNS,
  SECRET_UNAMBIGUOUS_PLACEHOLDER_VALUE_PATTERNS,
} from "../constants/security.js";

export const isPlaceholderSecretValue = (
  literalValue: string,
  hasPlaceholderContext: boolean,
): boolean => {
  const trimmedValue = literalValue.trim();
  if (trimmedValue.length === 0) return false;
  if (SECRET_UNAMBIGUOUS_PLACEHOLDER_VALUE_PATTERNS.some((pattern) => pattern.test(trimmedValue))) {
    return true;
  }
  if (!hasPlaceholderContext) return false;
  return SECRET_CONTEXTUAL_PLACEHOLDER_VALUE_PATTERNS.some((pattern) => pattern.test(trimmedValue));
};
