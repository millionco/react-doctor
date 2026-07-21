// rule: no-side-tab-border
// weakness: cascade-ambiguity
// source: adversarial parity review
// verdict: pass

export const PlainPanel = () => (
  <div
    className="!border-l-0 border-red-500"
    style={{ borderLeftColor: "red", borderLeftWidth: 8 }}
  />
);
