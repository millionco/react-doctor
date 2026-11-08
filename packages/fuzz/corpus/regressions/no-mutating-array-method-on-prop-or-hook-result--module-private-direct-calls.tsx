// rule: no-mutating-array-method-on-prop-or-hook-result
// verdict: pass
// weakness: framework-gating
// source: authored module-private direct-call ownership regression

export {};

function Drain(rows) {
  rows.splice(0, 1);
}

Drain([]);
