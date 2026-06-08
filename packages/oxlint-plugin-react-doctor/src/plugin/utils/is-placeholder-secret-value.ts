import {
  SECRET_CONTEXTUAL_PLACEHOLDER_VALUE_PATTERNS,
  SECRET_UNAMBIGUOUS_PLACEHOLDER_VALUE_PATTERNS,
} from "../constants/security.js";

interface PlaceholderSecretValueOptions {
  readonly allowContextualExamples: boolean;
}

export const isPlaceholderSecretValue = (
  literalValue: string,
  options: PlaceholderSecretValueOptions,
): boolean => {
  const trimmedValue = literalValue.trim();
  if (trimmedValue.length === 0) return false;
  if (SECRET_UNAMBIGUOUS_PLACEHOLDER_VALUE_PATTERNS.some((pattern) => pattern.test(trimmedValue))) {
    return true;
  }
  if (!options.allowContextualExamples) return false;
  return SECRET_CONTEXTUAL_PLACEHOLDER_VALUE_PATTERNS.some((pattern) => pattern.test(trimmedValue));
};
