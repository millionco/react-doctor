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

type Numeric = number;
type NumericPair = readonly [Numeric, Numeric];
type GenericNumericPair<Value> = readonly [Value, Value];

export const retainAliasedTupleStrictEquality = (
  candidates: readonly Numeric[],
  allowedValues: NumericPair,
): number[] => candidates.filter((candidate) => allowedValues.indexOf(candidate) !== -1);

export const retainConstrainedStrictEquality = <Value extends number | string>(
  candidates: readonly Value[],
  allowedValues: readonly Value[],
): Value[] => candidates.filter((candidate) => allowedValues.indexOf(candidate) !== -1);

export const retainGenericAliasStrictEquality = (
  candidates: readonly number[],
  allowedValues: GenericNumericPair<number>,
): number[] => candidates.filter((candidate) => allowedValues.indexOf(candidate) !== -1);
