// rule: js-set-map-lookups
// verdict: fail
// weakness: alias-guard
// source: independent synthetic native key iteration review

export const select = (rows, other) =>
  rows.every((row) => {
    ({ row } = other);
    return ["left", "right"].every((key) => Object.keys(row).includes(key));
  });
