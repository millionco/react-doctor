// rule: js-set-map-lookups
// verdict: pass
// weakness: name-heuristic
// source: independent synthetic native key iteration review

type Object = {};
export const select = (rows) =>
  rows.every((row) => ["left", "right"].every((key) => Object.keys(row).includes(key)));
