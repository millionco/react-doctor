// rule: js-set-map-lookups
// weakness: library-idiom
// source: adversarial review of PR #1190

interface Matcher {
  includes: (value: string) => boolean;
  indexOf: (value: string) => number;
}

export const retainUserlandMatches = (candidates: readonly string[], matcher: Matcher): string[] =>
  candidates.filter(
    (candidate) => matcher.includes(candidate) || matcher.indexOf(candidate) !== -1,
  );
