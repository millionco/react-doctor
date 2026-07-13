// rule: js-set-map-lookups
// weakness: wrapper-transparency
// source: independent adversarial review of PR #1190

export const retainCastNumericMembership = (candidates: unknown[], values: unknown): unknown[] => {
  const allowedValues = values as number[];
  return candidates.filter((candidate) => allowedValues.indexOf(candidate) !== -1);
};
