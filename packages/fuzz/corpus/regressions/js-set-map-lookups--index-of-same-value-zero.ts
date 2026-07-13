// rule: js-set-map-lookups
// weakness: other
// source: React Bench / ASAP SameValueZero false-positive report

export const retainStrictEqualityMembership = (
  candidates: readonly number[],
  allowedValues: readonly number[],
): number[] => {
  const matches: number[] = [];
  for (const candidate of candidates) {
    if (allowedValues.indexOf(candidate) !== -1) matches.push(candidate);
  }
  return matches;
};

export const retainSuffixMembership = (
  candidates: readonly number[],
  allowedValues: readonly number[],
): number[] => {
  const matches: number[] = [];
  for (const candidate of candidates) {
    if (allowedValues.includes(candidate, 1)) matches.push(candidate);
  }
  return matches;
};
