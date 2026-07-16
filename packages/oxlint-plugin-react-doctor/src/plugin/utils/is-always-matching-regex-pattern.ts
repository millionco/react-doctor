// Regex patterns that match at every position (`^\s*`, `.*`) — a single
// star-quantified atom, optionally anchored — so `.match`/`.exec` always
// produce a non-null result with `[0]` present.
const ALWAYS_MATCH_REGEX_PATTERN = /^\^?(?:\\[a-zA-Z]|\.|\[[^\]]*\])\*\$?$/;

export const isAlwaysMatchingRegexPattern = (pattern: unknown): boolean =>
  typeof pattern === "string" && ALWAYS_MATCH_REGEX_PATTERN.test(pattern);
