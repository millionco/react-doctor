// rule: js-set-map-lookups
// weakness: type-provenance
// source: adversarial review of PR #1190

export const retainBroadDomainMembership = <Value extends {}>(
  candidates: readonly Value[],
  allowedValues: readonly Value[],
): Value[] => candidates.filter((candidate) => allowedValues.indexOf(candidate) !== -1);
