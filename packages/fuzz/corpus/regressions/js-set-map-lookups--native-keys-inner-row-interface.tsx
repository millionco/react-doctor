// rule: js-set-map-lookups
// verdict: pass
// weakness: name-heuristic
// source: independent synthetic native key iteration review

export const select = (rows) =>
  rows.every((row) => {
    interface row {}
    return ["left", "right"].every((key) => Object.keys(row).includes(key));
  });
