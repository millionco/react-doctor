// rule: js-set-map-lookups
// verdict: pass
// weakness: name-heuristic
// source: independent synthetic native key iteration review

export const select = (rows) =>
  rows.every((row) => {
    function inspect() {
      interface row {}
      return row;
    }
    void inspect;
    return Object.keys(row).includes("field");
  });
