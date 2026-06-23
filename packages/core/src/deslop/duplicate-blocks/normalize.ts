import type { DuplicateBlockDetectionMode } from "../types.js";
import type { HashedToken, SourceToken } from "./token-types.js";

/**
 * 32-bit FNV-1a. Collisions are tolerable: ties are broken back to the
 * original (path, offset) tuples downstream, so a rare collision inflates a
 * duplicate block with one extra spurious instance at worst.
 */
const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

const hashString = (input: string): number => {
  let hash = FNV_OFFSET_BASIS;
  for (let charIndex = 0; charIndex < input.length; charIndex++) {
    hash ^= input.charCodeAt(charIndex);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
};

interface ResolvedNormalization {
  ignoreIdentifiers: boolean;
  ignoreStringValues: boolean;
  ignoreNumericValues: boolean;
}

const resolveNormalization = (mode: DuplicateBlockDetectionMode): ResolvedNormalization => {
  if (mode === "strict") {
    return { ignoreIdentifiers: false, ignoreStringValues: false, ignoreNumericValues: false };
  }
  return { ignoreIdentifiers: true, ignoreStringValues: true, ignoreNumericValues: true };
};

const hashSourceToken = (
  sourceToken: SourceToken,
  normalization: ResolvedNormalization,
): number => {
  switch (sourceToken.kind) {
    case "node-enter":
      return hashString(`n:${sourceToken.payload}`);
    case "identifier":
      return normalization.ignoreIdentifiers
        ? hashString("id:*")
        : hashString(`id:${sourceToken.payload}`);
    case "string-literal":
      return normalization.ignoreStringValues
        ? hashString("s:*")
        : hashString(`s:${sourceToken.payload}`);
    case "numeric-literal":
      return normalization.ignoreNumericValues
        ? hashString("num:*")
        : hashString(`num:${sourceToken.payload}`);
    case "boolean-literal":
      return hashString(`b:${sourceToken.payload}`);
    case "null-literal":
      return hashString("null");
    case "template-literal":
      return hashString("tpl");
    case "regexp-literal":
      return hashString("re");
    default:
      return hashString("?");
  }
};

export const normalizeAndHashTokens = (
  tokens: SourceToken[],
  mode: DuplicateBlockDetectionMode,
): HashedToken[] => {
  const normalization = resolveNormalization(mode);
  const hashedTokens: HashedToken[] = new Array(tokens.length);
  for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex++) {
    hashedTokens[tokenIndex] = {
      hash: hashSourceToken(tokens[tokenIndex], normalization),
      originalIndex: tokenIndex,
    };
  }
  return hashedTokens;
};
