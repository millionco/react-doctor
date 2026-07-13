// rule: js-set-map-lookups
// weakness: equality-semantics
// source: adversarial review of PR #1190

export const hasExplicitUndefined = (
  candidates: readonly unknown[],
  allowedValues: Array<unknown | undefined>,
): boolean => {
  for (const candidate of candidates) {
    if (candidate && allowedValues.indexOf(undefined) !== -1) return true;
  }
  return false;
};
