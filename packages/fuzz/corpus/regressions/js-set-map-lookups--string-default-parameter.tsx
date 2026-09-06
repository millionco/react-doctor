// rule: js-set-map-lookups
// weakness: value-provenance
// source: handwritten native parity regression
// verdict: pass

export const inspect = (values, candidate = "") =>
  values.map((value) => candidate.indexOf(value) >= 0);
