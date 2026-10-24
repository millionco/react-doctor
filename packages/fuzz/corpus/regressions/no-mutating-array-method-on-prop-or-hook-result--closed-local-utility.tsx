// rule: no-mutating-array-method-on-prop-or-hook-result
// weakness: name-heuristic
// source: synthetic
// verdict: pass
export const driveQueue = () => {
  "use strict";
  function FlushRows(rows) {
    rows.splice(0, 1);
  }
  FlushRows(["first", "second"]);
};
