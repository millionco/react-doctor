// rule: js-set-map-lookups
// weakness: callback-semantics
// source: independent adversarial review of PR #1190

export const countStrictMatches = (values: number[], allowedValues: number[]): number =>
  values.reduce((count, value) => (allowedValues.indexOf(value) !== -1 ? count + 1 : count), 0);
