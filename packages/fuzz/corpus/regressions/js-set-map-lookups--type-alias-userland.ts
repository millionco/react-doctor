// rule: js-set-map-lookups
// weakness: type-provenance
// source: independent adversarial review of PR #1190

interface Candidate {
  value: string;
}

type Matcher = { includes(value: string): boolean };
type MatcherProps = { matcher: Matcher };

export const retainUserlandAliasMatches = (
  candidates: Candidate[],
  { matcher }: MatcherProps,
): Candidate[] => candidates.filter((candidate) => matcher.includes(candidate.value));
