// Splits an identifier into its lowercased constituent words, handling
// camelCase, PascalCase, SCREAMING_SNAKE_CASE, and embedded acronyms
// (`getServerSession` -> ["get", "server", "session"], `verifyJWT` ->
// ["verify", "jwt"]). Returns [] when the name has no word characters.
const IDENTIFIER_WORD_PATTERN = /[A-Z]+(?=[A-Z][a-z]|\b)|[A-Z]?[a-z]+|\d+/g;

export const tokenizeIdentifierWords = (identifierName: string): string[] => {
  const words = identifierName.match(IDENTIFIER_WORD_PATTERN);
  if (!words) return [];
  return words.map((word) => word.toLowerCase());
};
