// rule: no-cramped-container-padding
// weakness: cascade-ambiguity
// source: adversarial parity review
// verdict: pass

export const TransparentPanel = () => (
  <div className="!bg-transparent p-0" style={{ backgroundColor: "red" }}>
    Status
  </div>
);
