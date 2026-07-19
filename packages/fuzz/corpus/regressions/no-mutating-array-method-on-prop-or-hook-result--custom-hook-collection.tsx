// rule: no-mutating-array-method-on-prop-or-hook-result
// weakness: library-idiom
// source: adversarial audit of render/data-safety rules
export const Ranking = () => {
  const ranking = useRanking();
  return ranking.sort();
};
