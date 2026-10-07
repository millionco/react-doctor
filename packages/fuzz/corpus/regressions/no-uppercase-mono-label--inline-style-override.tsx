// rule: no-uppercase-mono-label
// weakness: override-order
// source: 0.8.1-to-main all-rules parity audit
// verdict: pass

export const Label = () => (
  <span className="font-mono uppercase tracking-wide" style={{ fontFamily: "sans-serif" }}>
    System online
  </span>
);
