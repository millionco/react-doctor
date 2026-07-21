// rule: no-uppercase-mono-label
// weakness: override-order
// source: 0.8.1-to-main all-rules parity audit
// verdict: pass

export const Label = ({ props }) => (
  <span className="font-mono uppercase tracking-wide" {...props}>
    System online
  </span>
);
