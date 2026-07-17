// A single star-quantified atom whose empty fallback or character coverage
// guarantees `.match`/`.exec` returns a result with `[0]` present.
const ALWAYS_MATCH_REGEX_PATTERN = /^(\^)?(\\[a-zA-Z]|\.|\[[^\]]*\])\*(\$)?$/;
const EVERY_CHARACTER_REGEX_ATOMS = new Set([
  "[^]",
  "[\\s\\S]",
  "[\\S\\s]",
  "[\\d\\D]",
  "[\\D\\d]",
  "[\\w\\W]",
  "[\\W\\w]",
]);
const LINE_TERMINATORS_ONLY_NEGATED_CLASS = /^\[\^(?:\\[rn]|\\u2028|\\u2029)+\]$/;

export const isAlwaysMatchingRegexPattern = (pattern: unknown, flags?: unknown): boolean => {
  if (typeof pattern !== "string") return false;
  const patternMatch = pattern.match(ALWAYS_MATCH_REGEX_PATTERN);
  if (!patternMatch) return false;
  const [, startAnchor, atom, endAnchor] = patternMatch;
  if (!atom) return false;
  const regexFlags = typeof flags === "string" ? flags : "";
  const mustReachAnEndBoundary =
    Boolean(endAnchor) && (Boolean(startAnchor) || regexFlags.includes("y"));
  if (!mustReachAnEndBoundary) return true;
  return (
    EVERY_CHARACTER_REGEX_ATOMS.has(atom) ||
    (atom === "." && (regexFlags.includes("s") || regexFlags.includes("m"))) ||
    (regexFlags.includes("m") && LINE_TERMINATORS_ONLY_NEGATED_CLASS.test(atom))
  );
};
