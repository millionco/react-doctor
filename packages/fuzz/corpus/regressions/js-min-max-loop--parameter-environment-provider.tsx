// rule: js-min-max-loop
// weakness: alias-guard
// source: synthetic parameter environment regression
// verdict: pass
const Math = { min: (..._values: number[]) => 99 };

export function choose(value = [3, 1, 2].sort((left, right) => left - right)[0]) {
  const Math = globalThis.Math;
  return value;
}
