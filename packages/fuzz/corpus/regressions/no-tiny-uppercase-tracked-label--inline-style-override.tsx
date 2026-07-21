// rule: no-tiny-uppercase-tracked-label
// weakness: override-order
// source: 0.8.1-to-main all-rules parity audit
// verdict: pass

export const Label = () => (
  <span className="text-[10px] uppercase tracking-wide" style={{ fontSize: 16 }}>
    Recent activity
  </span>
);
