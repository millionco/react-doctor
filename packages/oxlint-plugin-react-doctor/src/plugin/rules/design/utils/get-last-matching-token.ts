export const getLastMatchingToken = (
  tokens: string[],
  predicate: (token: string) => boolean,
): string | null => {
  let matchingToken: string | null = null;
  for (const token of tokens) {
    if (predicate(token)) matchingToken = token;
  }
  return matchingToken;
};
